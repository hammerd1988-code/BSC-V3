/**
 * Read all of stdin as a UTF-8 string. Returns '' immediately when stdin is a
 * TTY (nothing was piped in). Used so secrets can be provided via a pipe
 * (e.g. `echo -n sk-... | casper config set openaiApiKey --stdin`) instead of
 * as a command-line argument that lands in shell history / process listings.
 */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
