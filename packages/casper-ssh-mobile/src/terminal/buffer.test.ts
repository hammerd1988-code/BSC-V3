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
    lines: result.lines.map(lineText),
  };
}

const initialState: TerminalBufferState = { pendingLine: [], cursorColumn: 0, style: {} };

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

it('keeps only the final segment of an interior carriage-return redraw', () => {
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
