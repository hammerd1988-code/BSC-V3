// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { describeAllowlist, runCasperShell } from './casperShell';

/**
 * These tests cover the validation layer, not the spawn. Every case here is
 * expected to be rejected before `bash -c` ever sees the string, so a failure
 * means a command reached the host.
 */
async function reject(command: string, mode: 'readonly' | 'elevated' = 'readonly') {
  const result = await runCasperShell(command, { mode, timeoutMs: 2_000 });
  expect(result.ok, `expected "${command}" to be rejected`).toBe(false);
  expect(result.exitCode, `"${command}" reached the shell`).toBeNull();
  return result;
}

describe('casper shell — interpreter escapes', () => {
  it('refuses inline script evaluation on allowlisted interpreters', async () => {
    // The allowlist used to inspect only the first token, so every one of these
    // passed validation and then ran arbitrary code under `bash -c`.
    for (const command of [
      `node -e "require('child_process').execSync('id')"`,
      'node --eval="process.exit(1)"',
      'node -p "process.env"',
      'node -r ./payload.js index.js',
      `python3 -c "import os; os.system('id')"`,
      `python -c "print(1)"`,
      'python3 -m http.server',
    ]) {
      const result = await reject(command);
      expect(result.reason).toBe('argument_not_permitted');
    }
  });

  it('refuses git options that hand execution to another binary', async () => {
    for (const command of [
      `git -c core.pager="sh -c id" log`,
      'git --exec-path=/tmp status',
      'git --upload-pack=/tmp/evil fetch origin',
    ]) {
      expect((await reject(command)).reason).toBe('argument_not_permitted');
    }
    // Ordinary read-only git still works.
    const ok = await runCasperShell('git --version', { mode: 'readonly', timeoutMs: 5_000 });
    expect(ok.reason).toBeUndefined();
  });

  it('refuses find/awk/sed forms that shell out', async () => {
    for (const command of [
      'find . -exec sh -c id {} +',
      'find /tmp -execdir cat {} +',
      `awk 'BEGIN{system("id")}'`,
      `awk '{print | "sh"}'`,
      `sed 'e id' file.txt`,
      `sed '1,3 w /tmp/out' file.txt`,
    ]) {
      expect((await reject(command)).reason).toBe('argument_not_permitted');
    }
  });

  it('keeps ordinary find/awk/sed usage working', async () => {
    for (const command of [
      'find . -name "*.ts" -type f',
      `awk '{print $1}' file.txt`,
      `sed -e 's/wide/narrow/g' file.txt`,
      `sed 's/e/E/'`,
    ]) {
      const result = await runCasperShell(command, { mode: 'readonly', timeoutMs: 5_000 });
      expect(result.reason, `"${command}" should not be rejected`).not.toBe('argument_not_permitted');
    }
  });

  it('refuses package managers running lifecycle scripts', async () => {
    for (const command of ['npm run build', 'npm install left-pad', 'yarn test', 'pnpm exec sh', 'pip install requests']) {
      expect((await reject(command)).reason).toBe('argument_not_permitted');
    }
    const ok = await runCasperShell('npm --version', { mode: 'readonly', timeoutMs: 20_000 });
    expect(ok.reason).toBeUndefined();
  });

  it('refuses launcher binaries used to start an un-allowlisted command', async () => {
    for (const command of ['env sh -c id', 'env FOO=bar bash', 'command sh -c id']) {
      expect((await reject(command)).reason).toBe('argument_not_permitted');
    }
    // Reporting forms stay usable.
    for (const command of ['env', 'command -v ls']) {
      const result = await runCasperShell(command, { mode: 'readonly', timeoutMs: 5_000 });
      expect(result.reason, `"${command}" should not be rejected`).not.toBe('argument_not_permitted');
    }
  });

  it('keeps npx and docker out of the readonly allowlist', async () => {
    const allow = describeAllowlist('readonly');
    expect(allow.binaries).not.toContain('npx');
    expect(allow.binaries).not.toContain('docker');
    expect(describeAllowlist('elevated').binaries).toContain('docker');
    expect((await reject('npx cowsay hi')).reason).toBe('binary_not_allowlisted');
  });
});

describe('casper shell — readonly means read only', () => {
  it('refuses redirection that writes a file', async () => {
    for (const command of ['echo pwned > /tmp/casper-test-marker', 'cat /etc/hosts >> /tmp/copy']) {
      expect((await reject(command)).reason).toBe('readonly_write_blocked');
    }
  });

  it('leaves commands without redirection alone', async () => {
    const result = await runCasperShell('echo hello', { mode: 'readonly', timeoutMs: 5_000 });
    expect(result.reason).toBeUndefined();
    expect(result.stdout.trim()).toBe('hello');
  });

  it('permits file redirection once elevated', async () => {
    const result = await runCasperShell('echo hi > /dev/null', { mode: 'elevated', timeoutMs: 5_000 });
    expect(result.reason).toBeUndefined();
  });

  it('refuses tee and curl/wget flags that write to disk', async () => {
    for (const command of ['ls | tee /tmp/out.txt', 'curl -o /tmp/x https://example.com', 'wget -O /tmp/x https://example.com']) {
      expect((await reject(command)).reason).toBe('argument_not_permitted');
    }
  });
});

describe('casper shell — existing protections still hold', () => {
  it('rejects separators and substitutions', async () => {
    for (const command of ['echo hi; sh', 'echo hi && sh', 'echo "$(sh)"', 'echo `sh`']) {
      const result = await reject(command);
      expect(result.reason).toMatch(/metacharacter/);
    }
  });

  it('runs a plain allowlisted command', async () => {
    const result = await runCasperShell('echo neural', { mode: 'readonly', timeoutMs: 5_000 });
    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe('neural');
  });
});
