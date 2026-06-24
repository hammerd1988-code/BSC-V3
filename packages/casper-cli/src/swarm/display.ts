/**
 * Cyberpunk display for the Casper Swarm.
 *
 * Live-updates the terminal with agent status, progress bars,
 * and styled output.
 */
import chalk from 'chalk';
import type { SwarmPlan, SwarmProgress, SubTask, AgentReport } from './types.js';
import { formatDuration, truncate } from './utils.js';

const NEON = chalk.magenta;
const CYBER = chalk.cyan;
const DIM = chalk.dim;
const GLOW = chalk.bold.magenta;
const SUCCESS = chalk.green;
const FAIL = chalk.red;
const WARN = chalk.yellow;
const BOLT = chalk.bold.cyan;

// ── Banners ──────────────────────────────────────────────────────────────────

export function printSwarmBanner(): void {
  console.log(`
${NEON('╔══════════════════════════════════════════════════════════╗')}
${NEON('║')}                                                          ${NEON('║')}
${NEON('║')}   ${GLOW('  CASPER SWARM')}  ${DIM('// multi-agent orchestration system')}    ${NEON('║')}
${NEON('║')}                                                          ${NEON('║')}
${NEON('║')}   ${DIM('Spawning sub-agents... deploying the hive mind.')}        ${NEON('║')}
${NEON('║')}                                                          ${NEON('║')}
${NEON('╚══════════════════════════════════════════════════════════╝')}
`);
}

export function printPlanBanner(plan: SwarmPlan): void {
  console.log(NEON('  ┌──────────────────────────────────────────────────────┐'));
  console.log(NEON('  │') + GLOW('  MISSION PLAN') + DIM(`  // ${plan.sessionId}`) + ' '.repeat(Math.max(0, 25 - plan.sessionId.length)) + NEON('│'));
  console.log(NEON('  ├──────────────────────────────────────────────────────┤'));
  console.log(NEON('  │') + `  ${BOLT('Objective:')} ${truncate(plan.objective, 40)}` + ' '.repeat(Math.max(0, 42 - Math.min(plan.objective.length, 40))) + NEON('│'));
  console.log(NEON('  │') + `  ${BOLT('Agents:')} ${plan.tasks.length} tasks, max ${plan.maxParallel} parallel` + ' '.repeat(Math.max(0, 30 - String(plan.tasks.length).length - String(plan.maxParallel).length)) + NEON('│'));
  console.log(NEON('  │') + `  ${BOLT('Model:')} ${plan.model}` + ' '.repeat(Math.max(0, 43 - plan.model.length)) + NEON('│'));
  console.log(NEON('  └──────────────────────────────────────────────────────┘'));
  console.log('');

  for (const task of plan.tasks) {
    const deps = task.dependsOn.length > 0
      ? DIM(` → after ${task.dependsOn.join(', ')}`)
      : DIM(' → independent');
    console.log(`  ${CYBER('▸')} ${BOLT(task.id)} ${task.description}`);
    console.log(`    ${deps}`);
  }
  console.log('');
}

// ── Progress ─────────────────────────────────────────────────────────────────

export function printProgress(progress: SwarmProgress): void {
  const { total, completed, running, failed, cancelled, pending, elapsedMs } = progress;
  const elapsed = formatDuration(elapsedMs);

  const bar = buildProgressBar(completed, failed, running, pending + cancelled, total);

  // Clear line and print
  process.stdout.write('\r\x1b[K');
  process.stdout.write(
    `  ${NEON('⟐')} ${bar} ${completed}/${total} done` +
    (failed > 0 ? ` ${FAIL(`${failed} failed`)}` : '') +
    (running > 0 ? ` ${CYBER(`${running} active`)}` : '') +
    ` ${DIM(elapsed)}`
  );
}

function buildProgressBar(completed: number, failed: number, running: number, remaining: number, total: number): string {
  const width = 20;
  const cChars = Math.round((completed / total) * width);
  const fChars = Math.round((failed / total) * width);
  const rChars = Math.round((running / total) * width);
  const pChars = width - cChars - fChars - rChars;

  return (
    NEON('[') +
    SUCCESS('█'.repeat(cChars)) +
    FAIL('█'.repeat(fChars)) +
    CYBER('▓'.repeat(rChars)) +
    DIM('░'.repeat(Math.max(0, pChars))) +
    NEON(']')
  );
}

// ── Agent Events ─────────────────────────────────────────────────────────────

export function printAgentStart(task: SubTask): void {
  process.stdout.write('\n');
  console.log(`  ${CYBER('⚡')} ${BOLT(task.id)} ${DIM('spawned →')} ${truncate(task.description, 60)}`);
}

export function printAgentComplete(task: SubTask, report: AgentReport): void {
  const duration = formatDuration(report.durationMs);
  const toolCount = report.toolCallLog.length;
  const fileCount = report.filesModified.length;

  if (report.status === 'completed') {
    console.log(
      `  ${SUCCESS('✓')} ${BOLT(task.id)} ${SUCCESS('completed')} ` +
      DIM(`(${duration}, ${toolCount} tools, ${fileCount} files)`)
    );
  } else {
    console.log(
      `  ${FAIL('✗')} ${BOLT(task.id)} ${FAIL('failed')} ` +
      DIM(`(${duration})`) +
      (report.error ? `: ${FAIL(truncate(report.error, 80))}` : '')
    );
  }
}

// ── Review ───────────────────────────────────────────────────────────────────

export function printReviewBanner(): void {
  console.log(`
${NEON('  ┌──────────────────────────────────────────────────────┐')}
${NEON('  │')}  ${GLOW('  MISSION REVIEW')}  ${DIM('// auditing sub-agent work')}         ${NEON('│')}
${NEON('  └──────────────────────────────────────────────────────┘')}
`);
}

export function printFinalReport(progress: SwarmProgress, review: string): void {
  const elapsed = formatDuration(progress.elapsedMs);
  const allFiles = [...new Set(progress.tasks.flatMap(t => t.filesModified))];

  console.log(`
${NEON('╔══════════════════════════════════════════════════════════╗')}
${NEON('║')}  ${GLOW('  SWARM COMPLETE')}                                        ${NEON('║')}
${NEON('╠══════════════════════════════════════════════════════════╣')}
${NEON('║')}  ${BOLT('Objective:')} ${truncate(progress.objective, 42)}${' '.repeat(Math.max(0, 42 - Math.min(progress.objective.length, 42)))} ${NEON('║')}
${NEON('║')}  ${BOLT('Duration:')}  ${elapsed}${' '.repeat(Math.max(0, 43 - elapsed.length))} ${NEON('║')}
${NEON('║')}  ${BOLT('Results:')}   ${SUCCESS(`${progress.completed} passed`)}${progress.failed > 0 ? ` ${FAIL(`${progress.failed} failed`)}` : ''}${progress.cancelled > 0 ? ` ${WARN(`${progress.cancelled} cancelled`)}` : ''}${' '.repeat(Math.max(0, 20))} ${NEON('║')}
${NEON('╚══════════════════════════════════════════════════════════╝')}
`);

  // Task breakdown
  for (const task of progress.tasks) {
    const icon = task.status === 'completed' ? SUCCESS('✓')
      : task.status === 'failed' ? FAIL('✗')
      : task.status === 'cancelled' ? WARN('○')
      : DIM('·');
    const dur = task.completedAt && task.startedAt
      ? DIM(` ${formatDuration(task.completedAt - task.startedAt)}`)
      : '';
    console.log(`  ${icon} ${CYBER(task.id)}${dur} — ${task.description}`);
    if (task.filesModified.length > 0) {
      console.log(DIM(`    files: ${task.filesModified.join(', ')}`));
    }
    if (task.error) {
      console.log(FAIL(`    error: ${truncate(task.error, 80)}`));
    }
  }

  if (allFiles.length > 0) {
    console.log(DIM(`\n  Total files touched: ${allFiles.length}`));
  }

  // LLM review
  console.log(NEON('\n  ── Casper\'s Review ──────────────────────────────────────\n'));
  console.log(review.split('\n').map(line => `  ${line}`).join('\n'));
  console.log('');
}
