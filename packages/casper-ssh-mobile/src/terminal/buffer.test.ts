import {
  appendTerminalInput,
  TerminalBufferState,
} from './buffer';
import { expect, it } from 'vitest';

function lineText(line: { text: string }[]): string {
  return line.map((span) => span.text).join('');
}

function append(state: TerminalBufferState, value: string): TerminalBufferState & { lines: string[] } {
  const result = appendTerminalInput(state, value);
  return {
    pendingLine: result.pendingLine,
    cursorColumn: result.cursorColumn,
    style: result.style,
    escapeRemainder: result.escapeRemainder,
    discardingEscape: result.discardingEscape,
    lines: result.lines.map(lineText),
  };
}

const initialState: TerminalBufferState = {
  pendingLine: [],
  cursorColumn: 0,
  style: {},
  escapeRemainder: '',
  discardingEscape: null,
};

it('renders text from a CRLF-terminated line', () => {
  expect(append(initialState, 'VISIBLE_MARKER_123\r\n')).toMatchObject({
    lines: ['VISIBLE_MARKER_123'],
    pendingLine: [],
  });
});

it('renders LF-only lines', () => {
  expect(append(initialState, 'VISIBLE_MARKER_123\n')).toMatchObject({
    lines: ['VISIBLE_MARKER_123'],
    pendingLine: [],
  });
});

it('overwrites from column zero for an interior carriage-return redraw', () => {
  expect(append(initialState, 'old progress\rnew progress\n')).toMatchObject({
    lines: ['new progress'],
    pendingLine: [],
  });
});

it('removes only the line-ending CR when the line ends in CRCRLF', () => {
  expect(append(initialState, 'progress\r\r\n')).toMatchObject({
    lines: ['progress'],
    pendingLine: [],
  });
});

it('overlays a shorter redraw onto the existing line', () => {
  expect(append(initialState, 'old progress\rnew\n')).toMatchObject({
    lines: ['new progress'],
    pendingLine: [],
  });
});

it('overlays colored redraws without escape-sequence junk and preserves tail styles', () => {
  const result = appendTerminalInput(
    initialState,
    '\u001b[32mLONGTEXT\u001b[0mTAIL\r\u001b[31mNO\n',
  );
  const text = lineText(result.lines[0]);

  expect(text).toBe('NONGTEXTTAIL');
  expect(text).not.toContain('32m');
  expect(result.lines[0].find((span) => span.text === 'NO')?.style).toEqual({ color: '#f87171' });
  expect(result.lines[0].find((span) => span.text.includes('NGTEXT'))?.style).toEqual({ color: '#4ade80' });
});

it('counts overwrite columns without counting escape bytes in the prefix', () => {
  const result = appendTerminalInput(initialState, '\u001b[32mOK\u001b[0mTAIL\rX\n');
  const text = lineText(result.lines[0]);

  expect(text).toBe('XKTAIL');
  expect(text).not.toMatch(/[0-9]+m/);
});

it('reassembles a CRLF split across chunks', () => {
  const afterCarriageReturn = append(initialState, 'VISIBLE_MARKER_123\r');
  expect(afterCarriageReturn).toMatchObject({
    lines: [],
    pendingLine: [{ text: 'VISIBLE_MARKER_123' }],
    cursorColumn: 0,
  });

  expect(append(afterCarriageReturn, '\n')).toMatchObject({
    lines: ['VISIBLE_MARKER_123'],
    pendingLine: [],
  });
});

it('overlays a shorter redraw across chunk boundaries', () => {
  const afterCarriageReturn = append(initialState, 'old progress\r');
  expect(append(afterCarriageReturn, 'new\n')).toMatchObject({
    lines: ['new progress'],
    pendingLine: [],
  });
});

it('preserves the colored tail across a chunk-boundary redraw', () => {
  const first = appendTerminalInput(initialState, '\u001b[32mold progress\r');
  const result = appendTerminalInput(first, '\u001b[31mnew\n');

  expect(lineText(result.lines[0])).toBe('new progress');
  expect(result.lines[0].find((span) => span.text === 'new')?.style).toEqual({ color: '#f87171' });
  expect(result.lines[0].find((span) => span.text === ' progress')?.style).toEqual({ color: '#4ade80' });
});

it('bounds a newline-free carriage-return spinner to its longest segment', () => {
  let state = initialState;
  for (const segment of ['spinner 100%', 'spinner 99%', 'spinner 9%', 'spinner 1%']) {
    state = append(state, `${segment}\r`);
  }

  expect(lineText(state.pendingLine).length).toBeLessThanOrEqual('spinner 100%'.length);
});

it('keeps text after a trailing reset unstyled across chunks', () => {
  const first = appendTerminalInput(initialState, '\u001b[31mRED\u001b[0m');
  const second = appendTerminalInput(first, 'PLAIN');

  expect(lineText(second.pendingLine)).toBe('REDPLAIN');
  expect(second.pendingLine.find((span) => span.text === 'PLAIN')?.style).toEqual({});
});

it('keeps a reset at the start of the next line', () => {
  const result = appendTerminalInput(
    initialState,
    '\u001b[31mRED\n\u001b[0mPLAIN\n',
  );

  expect(lineText(result.lines[0])).toBe('RED');
  expect(lineText(result.lines[1])).toBe('PLAIN');
  expect(result.lines[0][0].style).toEqual({ color: '#f87171' });
  expect(result.lines[1][0].style).toEqual({});
});

it('reassembles an escape sequence split across chunks', () => {
  const first = append(initialState, '\u001b[3');
  expect(first.pendingLine).toEqual([]);
  expect(first.escapeRemainder).toBe('\u001b[3');

  const result = appendTerminalInput(first, '2mGREEN\n');
  expect(lineText(result.lines[0])).toBe('GREEN');
  expect(result.lines[0]).toEqual([
    { text: 'GREEN', style: { color: '#4ade80' } },
  ]);
  expect(lineText(result.lines[0])).not.toMatch(/\[3|32m/);
});

it('does not render an incomplete escape sequence as cells', () => {
  const result = append(initialState, '\u001b[3');

  expect(result.pendingLine).toEqual([]);
  expect(result.lines).toEqual([]);
  expect(result.style).toEqual({});
  expect(result.escapeRemainder).toBe('\u001b[3');
});

it('erases from the cursor to the end of the line with K', () => {
  expect(append(initialState, 'downloading 100%\r\u001b[Kdone\n').lines).toEqual(['done']);
});

it('clears the whole line with 2K', () => {
  expect(append(initialState, 'stale text\r\u001b[2K\n').lines).toEqual(['']);
});

it('keeps the cursor column after 2K across chunks', () => {
  const cleared = append(initialState, '0123456789\u001b[2K');
  expect(cleared.cursorColumn).toBe(10);
  expect(append(cleared, 'X\n').lines).toEqual(['          X']);
});

it('blanks the head while keeping the tail with 1K', () => {
  expect(append(initialState, 'abcdef\rabc\u001b[1K\n').lines).toEqual(['    ef']);
});

it('discards an over-long OSC sequence across chunks', () => {
  const first = append(initialState, `\u001b]0;${'window-title/'.repeat(8)}`);
  expect(first.pendingLine).toEqual([]);
  expect(first.escapeRemainder).toBe('');
  expect(first.discardingEscape).toBe('osc');

  const result = appendTerminalInput(first, '\u0007\u001b[32mVISIBLE\n');
  expect(lineText(result.lines[0])).toBe('VISIBLE');
  expect(result.lines[0][0].style).toEqual({ color: '#4ade80' });
  expect(lineText(result.lines[0])).not.toMatch(/\]0;|window-title|BEL/);
});

it('discards an over-long CSI sequence across chunks', () => {
  const first = append(initialState, `\u001b[${'1'.repeat(70)}`);
  expect(first.pendingLine).toEqual([]);
  expect(first.escapeRemainder).toBe('');
  expect(first.discardingEscape).toBe('csi');

  const result = appendTerminalInput(first, 'm\u001b[31mVISIBLE\n');
  expect(lineText(result.lines[0])).toBe('VISIBLE');
  expect(result.lines[0][0].style).toEqual({ color: '#f87171' });
  expect(lineText(result.lines[0])).not.toMatch(/1+m/);
});

it('resumes after an over-long OSC split between ESC and its terminator', () => {
  const first = append(initialState, `\u001b]0;${'window-title/'.repeat(8)}\u001b`);
  expect(first.pendingLine).toEqual([]);
  expect(first.discardingEscape).toBe('osc-escape');

  const result = appendTerminalInput(first, '\\VISIBLE\n');
  expect(lineText(result.lines[0])).toBe('VISIBLE');
});
