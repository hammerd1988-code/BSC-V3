/**
 * IPC channel names shared between the main process and the preload bridge.
 * Kept in one place so both sides stay in sync.
 */
export const IPC = {
  appVersion: 'bsc:app:version',
  localLlmDetect: 'bsc:llm:detect',
  localLlmProbe: 'bsc:llm:probe',
  localLlmChat: 'bsc:llm:chat',
  casperRun: 'bsc:casper:run',
  casperVersion: 'bsc:casper:version',
  updateStatus: 'bsc:update:status',
} as const;
