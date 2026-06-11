import os from 'os';
import { execSync } from 'child_process';

export function getSystemInfo(): { ok: boolean; data: unknown } {
  const cpus = os.cpus();
  let diskUsage: string | undefined;
  try {
    diskUsage = execSync('df -h / 2>/dev/null || echo "unavailable"', { encoding: 'utf-8' }).trim();
  } catch { /* skip */ }

  return {
    ok: true,
    data: {
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      cpus: {
        model: cpus[0]?.model,
        count: cpus.length,
        load: os.loadavg(),
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        usedPercent: Math.round((1 - os.freemem() / os.totalmem()) * 100),
      },
      disk: diskUsage,
      nodeVersion: process.version,
      cwd: process.cwd(),
      user: os.userInfo().username,
      home: os.homedir(),
    },
  };
}
