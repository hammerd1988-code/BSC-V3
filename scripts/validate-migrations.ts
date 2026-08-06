/**
 * Applies every file in supabase/migrations to a throwaway in-process Postgres
 * and reports the first statement in each file that fails.
 *
 *   npx tsx scripts/validate-migrations.ts
 *
 * The same harness runs in CI via supabase/migrations.test.ts.
 */
import { applyMigrations, createDatabase, migrationFiles } from './migrationHarness';

async function main() {
  const db = await createDatabase();
  const failures = await applyMigrations(db, (file, failure) => {
    if (failure) {
      console.error(`  FAIL ${file}\n       ${failure.message.split('\n').join('\n       ')}`);
    } else {
      console.log(`  ok   ${file}`);
    }
  });

  const total = migrationFiles().length;
  console.log(`\n${total - failures.length}/${total} migrations applied cleanly.`);
  await db.close();
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
