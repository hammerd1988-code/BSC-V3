/**
 * CLI commands for the Casper Swarm.
 */
import chalk from 'chalk';
import ora from 'ora';
import { planTasks } from './planner.js';
import { Orchestrator } from './orchestrator.js';
import {
  printSwarmBanner,
  printPlanBanner,
  printProgress,
  printAgentStart,
  printAgentComplete,
  printReviewBanner,
  printFinalReport,
} from './display.js';

export interface OrchestrateOptions {
  model?: string;
  maxParallel?: number;
  maxTasks?: number;
  dryRun?: boolean;
}

/**
 * Main entry point: decompose an objective into subtasks, spawn agents,
 * monitor progress, review results.
 */
export async function orchestrate(
  objective: string,
  opts: OrchestrateOptions = {},
): Promise<void> {
  printSwarmBanner();

  // Phase 1: Plan
  const planSpinner = ora({
    text: chalk.dim('  Decomposing objective into subtasks...'),
    spinner: 'dots',
  }).start();

  let plan;
  try {
    plan = await planTasks(objective, {
      model: opts.model,
      maxTasks: opts.maxTasks,
    });
    planSpinner.stop();
  } catch (err) {
    planSpinner.stop();
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`  Failed to plan: ${msg}`));
    process.exit(1);
  }

  if (opts.maxParallel) {
    plan.maxParallel = opts.maxParallel;
  }

  printPlanBanner(plan);

  // Dry run — just show the plan
  if (opts.dryRun) {
    console.log(chalk.dim('  --dry-run: plan shown above. No agents spawned.\n'));
    return;
  }

  // Phase 2: Execute
  console.log(chalk.magenta('  ── Deploying agents ─────────────────────────────────────\n'));

  const orchestrator = new Orchestrator(plan, {
    maxParallel: plan.maxParallel,
    model: opts.model,
    onProgress: (progress) => {
      printProgress(progress);
    },
    onAgentStart: (task) => {
      printAgentStart(task);
    },
    onAgentComplete: (task, report) => {
      printAgentComplete(task, report);
    },
  });

  let review: string;
  try {
    // Clear the progress line before review
    printReviewBanner();
    review = await orchestrator.run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`\n  Swarm error: ${msg}`));
    review = `Swarm execution failed: ${msg}`;
  }

  // Phase 3: Report
  const finalProgress = orchestrator.getProgress();
  process.stdout.write('\n');
  printFinalReport(finalProgress, review);
}
