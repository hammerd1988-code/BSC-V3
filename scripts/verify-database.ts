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

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

/**
 * A second, deliberately unprivileged client. The RLS probe needs to ask the
 * database what an anonymous visitor can read, which the service-role client
 * can never answer because it bypasses RLS entirely.
 */
const anonClient: SupabaseClient | null = supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

/** PostgREST reports an unknown relation differently across versions. */
function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST204') return true;
  return /could not find the table|does not exist/i.test(error.message ?? '');
}

/** Refused by a GRANT or by a policy, as opposed to "there is no such table". */
function isAccessDenied(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42501') return true;
  return /permission denied|row-level security/i.test(error.message ?? '');
}

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
  const { error } = await supabase.from('users').select('id').limit(1);
  if (error) {
    console.error(`  ✗ Database connection failed: ${error.message}`);
    return false;
  }
  console.log('  ✓ Database connection successful');
  return true;
}

async function verifyTables(): Promise<{ found: string[]; missing: string[]; denied: string[] }> {
  console.log('\n[2/4] Verifying required tables...');
  const found: string[] = [];
  const missing: string[] = [];
  const denied: string[] = [];

  for (const table of REQUIRED_TABLES) {
    const { error } = await supabase.from(table).select('*').limit(0);
    if (!error) {
      found.push(table);
      console.log(`  ✓ ${table}`);
    } else if (isAccessDenied(error)) {
      // The table is there; this key just cannot read it. Reporting it as
      // missing sent people off to re-run migrations that were already applied.
      denied.push(table);
      console.log(`  ⚠ ${table} - exists but this key is not allowed to read it`);
    } else if (isMissingRelation(error)) {
      missing.push(table);
      console.log(`  ✗ ${table} - NOT FOUND`);
    } else {
      missing.push(table);
      console.log(`  ✗ ${table} - ${error.message}`);
    }
  }

  return { found, missing, denied };
}

/**
 * Tables an anonymous visitor must never be able to read a row out of. Read-only
 * on purpose: probing with a write would put junk in whatever database this is
 * pointed at, and production is a realistic target for this script.
 */
const ANON_MUST_NOT_READ = [
  'transactions',
  'notifications',
  'transmits',
  'casper_activity_log',
  'bot_api_keys',
];

/**
 * Asks the database what anonymous callers can actually read, rather than
 * asserting something about a migration file.
 *
 * A leak is conclusive on its own. "No rows returned" only proves something when
 * the table is not simply empty, so the privileged client counts the rows first
 * and an empty table is reported as inconclusive instead of as a pass.
 */
async function verifyRLS(): Promise<boolean> {
  console.log('\n[3/4] Verifying RLS on tables that must stay private...');

  if (!anonClient) {
    console.log('  ⚠ Cannot verify: no anon/publishable key available to probe with');
    return true;
  }

  let leaked = false;
  let conclusive = 0;

  for (const table of ANON_MUST_NOT_READ) {
    const { data, error } = await anonClient.from(table).select('*').limit(1);

    if (isMissingRelation(error)) {
      console.log(`  ⚠ ${table} - table not present, skipped`);
      continue;
    }
    if (isAccessDenied(error)) {
      console.log(`  ✓ ${table} - anon access refused`);
      conclusive++;
      continue;
    }
    if (error) {
      console.log(`  ⚠ ${table} - probe failed: ${error.message}`);
      continue;
    }
    if ((data?.length ?? 0) > 0) {
      console.log(`  ✗ ${table} - LEAK: anonymous callers can read rows`);
      leaked = true;
      continue;
    }

    // Empty result. Distinguish "RLS filtered every row" from "table is empty".
    if (!hasUsableServiceKey) {
      console.log(`  ⚠ ${table} - anon read returned no rows (inconclusive without a service role key)`);
      continue;
    }
    const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if ((count ?? 0) > 0) {
      console.log(`  ✓ ${table} - ${count} row(s) present, none visible to anon`);
      conclusive++;
    } else {
      console.log(`  ⚠ ${table} - table is empty, cannot tell RLS from emptiness`);
    }
  }

  if (leaked) return false;
  if (conclusive === 0) {
    console.log('  ⚠ RLS could not be confirmed for any table (nothing to read)');
  }
  return true;
}

async function verifyStorage(): Promise<boolean> {
  console.log('\n[4/4] Verifying storage bucket...');

  if (!hasUsableServiceKey) {
    console.log('  ⚠ Skipping storage bucket check (requires service role key)');
    return true;
  }
  
  const bucketName = process.env.VITE_SUPABASE_STORAGE_BUCKET || 'media';
  
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    
    if (error) {
      console.log(`  ⚠ Could not list buckets: ${error.message}`);
      return false;
    }
    
    const bucket = buckets?.find(b => b.name === bucketName);
    
    if (bucket) {
      console.log(`  ✓ Storage bucket '${bucketName}' exists`);
      console.log(`    - Public: ${bucket.public}`);
      return true;
    } else {
      console.log(`  ✗ Storage bucket '${bucketName}' not found`);
      console.log(`    Available buckets: ${buckets?.map(b => b.name).join(', ') || 'none'}`);
      return false;
    }
  } catch (error) {
    console.log(`  ⚠ Storage verification failed: ${error}`);
    return false;
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

  const { found, missing, denied } = await verifyTables();
  const rlsOk = await verifyRLS();
  const storageOk = await verifyStorage();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\nTables: ${found.length}/${REQUIRED_TABLES.length} readable, ${denied.length} present but unreadable, ${missing.length} missing`);

  if (missing.length > 0) {
    console.log(`\n✗ Missing tables: ${missing.join(', ')}`);
    console.log('\nTo create missing tables, run the migration:');
    console.log('  npx supabase db push');
    console.log('  OR apply the full supabase/migrations directory in order, including the latest complete feature schema migration.');
  } else {
    console.log('\n✓ All required tables are present');
  }

  if (denied.length > 0) {
    console.log(`\n⚠ Not readable with this key (expected when running with the anon key): ${denied.join(', ')}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');

  // Exit non-zero so callers and CI can act on the result. Previously every
  // check returned true and the process always exited 0, which meant a database
  // with missing tables or a public `transactions` table still "passed".
  if (missing.length > 0 || !rlsOk || !storageOk) {
    console.log('❌ Database verification failed\n');
    process.exit(1);
  }
  console.log('✅ Database verification passed\n');
}

main().catch((error) => {
  console.error('\n❌ Database verification crashed:', error);
  process.exit(1);
});
