/**
 * Database verification script for Blood Sweat Code
 * 
 * Run with: npx tsx --env-file=.env.local scripts/verify-database.ts
 * Or via v0: node --env-file-if-exists=/vercel/share/.env.project scripts/verify-database.ts
 * 
 * This script verifies:
 * 1. Database connection
 * 2. Required tables exist
 * 3. RLS policies are enabled
 * 4. Storage bucket exists
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKeyRaw = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const hasUsableServiceKey = !!supabaseServiceKeyRaw
  && !supabaseServiceKeyRaw.includes('your_supabase_service_role_key_here')
  && !supabaseServiceKeyRaw.includes('YOUR_')
  && supabaseServiceKeyRaw.length > 32;

if (!supabaseUrl) {
  console.error('Error: SUPABASE_URL is not set');
  process.exit(1);
}

// Use service role key only if it appears to be a real key; otherwise fall back to anon.
const apiKey = (hasUsableServiceKey ? supabaseServiceKeyRaw : undefined) || supabaseAnonKey;

if (!apiKey) {
  console.error('Error: No Supabase API key found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, apiKey);

const REQUIRED_TABLES = [
  // Core social graph and feed
  'users',
  'posts',
  'comments',
  'post_likes',
  'post_reactions',
  'follows',
  'transactions',
  'notifications',
  'achievements',
  'referrals',
  'account_deletion_feedback',

  // Messaging / transmissions
  'transmissions',
  'transmits',
  'direct_messages',

  // Live streaming and video
  'streams',
  'stream_chat',
  'stream_followers',
  'stream_reactions',
  'videos',

  // Colosseum / tournaments
  'gladiators',
  'matches',
  'tournaments',
  'tournament_entries',

  // Casper / GhostOps / content studio
  'casper_state',
  'casper_memories',
  'casper_config',
  'casper_tasks',
  'casper_activity_log',
  'scheduled_content',
  'content_ideas',
  'content_clips',
  'casper_subagents',

  // Profiles, factions, and activity
  'factions',
  'faction_members',
  'faction_posts',
  'user_activity_daily',

  // Bots and automations
  'bot_listings',
  'bot_purchases',
  'bot_api_keys',
  'bot_webhook_subscriptions',

  // Existing specialized surfaces
  'void_posts',
  'bounties',
  'active_threats',
];

async function verifyConnection(): Promise<boolean> {
  console.log('\n[1/4] Verifying database connection...');
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error && !error.message.includes('0 rows')) {
      throw error;
    }
    console.log('  ✓ Database connection successful');
    return true;
  } catch (error) {
    console.error('  ✗ Database connection failed:', error);
    return false;
  }
}

async function verifyTables(): Promise<{ found: string[]; missing: string[] }> {
  console.log('\n[2/4] Verifying required tables...');
  const found: string[] = [];
  const missing: string[] = [];

  for (const table of REQUIRED_TABLES) {
    try {
      const { error } = await supabase.from(table).select('*').limit(0);
      if (error) {
        missing.push(table);
        console.log(`  ✗ ${table} - NOT FOUND or access denied`);
      } else {
        found.push(table);
        console.log(`  ✓ ${table}`);
      }
    } catch {
      missing.push(table);
      console.log(`  ✗ ${table} - ERROR`);
    }
  }

  return { found, missing };
}

type CheckResult = 'ok' | 'failed' | 'unverified';

/**
 * Every branch of this used to return true, and one of them printed
 * "✓ RLS is enabled in migration file (0001_init.sql)" — a claim about a file it
 * never opened, on the path taken when the check had just failed to run. The
 * RPC it calls, get_tables_with_rls_status, does not exist in any migration, so
 * that was the only path ever taken: the step reported a pass unconditionally.
 *
 * It now distinguishes "verified" from "could not verify". RLS on every public
 * table is asserted properly by supabase/migrations.test.ts, which applies the
 * real migration chain to Postgres, so that is where an unverified run is sent.
 */
async function verifyRLS(): Promise<CheckResult> {
  console.log('\n[3/4] Verifying RLS policies...');

  if (!hasUsableServiceKey) {
    console.log('  ⚠ Cannot verify RLS (requires service role key)');
    return 'unverified';
  }

  try {
    const { data, error } = await supabase.rpc('get_tables_with_rls_status');

    if (error) {
      console.log(`  ⚠ Cannot verify RLS against this database: ${error.message}`);
      console.log('    Run `npm run test:run` — supabase/migrations.test.ts asserts');
      console.log('    that every table in `public` has RLS enabled.');
      return 'unverified';
    }

    const tables = (data ?? []) as Array<{ table_name?: string; rls_enabled?: boolean }>;
    if (tables.length === 0) {
      console.log('  ⚠ RLS status query returned no rows');
      return 'unverified';
    }

    const unprotected = tables.filter((table) => table.rls_enabled === false);
    if (unprotected.length > 0) {
      console.log(`  ✗ RLS disabled on: ${unprotected.map((t) => t.table_name).join(', ')}`);
      return 'failed';
    }

    console.log(`  ✓ RLS enabled on all ${tables.length} tables`);
    return 'ok';
  } catch (error) {
    console.log(`  ⚠ Cannot verify RLS: ${error instanceof Error ? error.message : error}`);
    return 'unverified';
  }
}

async function verifyStorage(): Promise<CheckResult> {
  console.log('\n[4/4] Verifying storage bucket...');

  if (!hasUsableServiceKey) {
    console.log('  ⚠ Cannot check storage bucket (requires service role key)');
    return 'unverified';
  }
  
  const bucketName = process.env.VITE_SUPABASE_STORAGE_BUCKET || 'media';
  
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    
    if (error) {
      console.log(`  ⚠ Could not list buckets: ${error.message}`);
      return 'unverified';
    }
    
    const bucket = buckets?.find(b => b.name === bucketName);
    
    if (bucket) {
      console.log(`  ✓ Storage bucket '${bucketName}' exists`);
      console.log(`    - Public: ${bucket.public}`);
      return 'ok';
    } else {
      console.log(`  ✗ Storage bucket '${bucketName}' not found`);
      console.log(`    Available buckets: ${buckets?.map(b => b.name).join(', ') || 'none'}`);
      return 'failed';
    }
  } catch (error) {
    console.log(`  ⚠ Storage verification failed: ${error}`);
    return 'unverified';
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Blood Sweat Code - Database Verification');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\nSupabase URL: ${supabaseUrl}`);
  console.log(`Using key type: ${hasUsableServiceKey ? 'service_role' : 'anon'}`);

  const connectionOk = await verifyConnection();
  if (!connectionOk) {
    console.log('\n❌ Database verification failed - connection error');
    process.exit(1);
  }

  const { found, missing } = await verifyTables();
  const rls = await verifyRLS();
  const storage = await verifyStorage();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\nTables: ${found.length}/${REQUIRED_TABLES.length} found`);
  
  if (missing.length > 0) {
    console.log(`\n⚠ Missing tables: ${missing.join(', ')}`);
    console.log('\nTo create missing tables, run the migration:');
    console.log('  npx supabase db push');
    console.log('  OR apply the full supabase/migrations directory in order, including the latest complete feature schema migration.');
  } else {
    console.log('\n✓ All required tables are present');
  }

  const unverified = [
    rls === 'unverified' ? 'RLS' : null,
    storage === 'unverified' ? 'storage bucket' : null,
  ].filter(Boolean);
  if (unverified.length > 0) {
    console.log(`\n⚠ Not verified: ${unverified.join(', ')}`);
  }

  // The results of these checks used to be discarded and the script exited 0
  // whatever it found, so "verification passed" meant only that the connection
  // worked. AGENTS.md points here after schema changes, so a real failure has
  // to be a real failure.
  const failures = [
    missing.length > 0 ? `${missing.length} missing table(s)` : null,
    rls === 'failed' ? 'RLS disabled on one or more tables' : null,
    storage === 'failed' ? 'storage bucket missing' : null,
  ].filter(Boolean);

  console.log('\n═══════════════════════════════════════════════════════════\n');

  if (failures.length > 0) {
    console.log(`❌ Database verification failed: ${failures.join('; ')}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  // `catch(console.error)` logged and then exited 0, so a crash mid-verification
  // was indistinguishable from a pass.
  console.error('\n❌ Database verification crashed:', error);
  process.exit(1);
});
