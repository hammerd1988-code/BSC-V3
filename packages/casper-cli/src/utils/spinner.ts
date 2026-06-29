import process from 'node:process';

/**
 * Minimal, pkg-safe spinner that mimics the slice of the `ora` API this CLI
 * uses (`start`/`stop`/`text`/`succeed`/`fail`).
 *
 * The real `ora` package crashes pkg-bundled standalone binaries with an
 * access violation (0xC0000005) on Windows: it mutes stdin via raw-mode
 * toggling (`stdin-discarder`) and manipulates the cursor through native
 * signal handlers. This implementation only writes ANSI sequences to stdout,
 * so it has no stdin/native dependencies and is safe inside the binary. On a
 * non-TTY stream it degrades to plain `console.log` output.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const CLEAR_LINE = '\r\u001b[K';

export interface SpinnerOptions {
  text?: string;
  spinner?: string; // accepted for ora compatibility; unused
}

export class Spinner {
  text: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private readonly isTTY: boolean;

  constructor(opts?: string | SpinnerOptions) {
    const o = typeof opts === 'string' ? { text: opts } : opts ?? {};
    this.text = o.text ?? '';
    this.isTTY = Boolean(process.stdout.isTTY);
  }

  start(text?: string): this {
    if (text !== undefined) this.text = text;
    if (this.timer) return this;
    if (!this.isTTY) {
      if (this.text) console.log(this.text);
      return this;
    }
    const render = () => {
      this.frame = (this.frame + 1) % FRAMES.length;
      process.stdout.write(`${CLEAR_LINE}${FRAMES[this.frame]} ${this.text}`);
    };
    render();
    this.timer = setInterval(render, 80);
    return this;
  }

  stop(): this {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.isTTY) process.stdout.write(CLEAR_LINE);
    return this;
  }

  succeed(text?: string): this {
    this.stop();
    console.log(text ?? this.text);
    return this;
  }

  fail(text?: string): this {
    this.stop();
    console.log(text ?? this.text);
    return this;
  }
}

export default function ora(opts?: string | SpinnerOptions): Spinner {
  return new Spinner(opts);
}
