import {
  appendTerminalInput,
  overwriteCarriageReturns,
  TerminalBufferState,
} from './buffer';
import { expect, it } from 'vitest';

function append(state: TerminalBufferState, value: string): TerminalBufferState & { lines: string[] } {
  const result = appendTerminalInput(state, value);
  return {
    pendingLine: result.pendingLine,
    style: result.style,
    lines: result.lines.map((line) => line.map((span) => span.text).join('')),
  };
}

const initialState: TerminalBufferState = { pendingLine: '', style: {} };

it('renders text from a CRLF-terminated line', () => {
  expect(append(initialState, 'VISIBLE_MARKER_123\r\n')).toMatchObject({
    lines: ['VISIBLE_MARKER_123'],
    pendingLine: '',
  });
});

it('renders LF-only lines', () => {
  expect(append(initialState, 'VISIBLE_MARKER_123\n')).toMatchObject({
    lines: ['VISIBLE_MARKER_123'],
    pendingLine: '',
  });
});

it('keeps only the final segment of an interior carriage-return redraw', () => {
  expect(append(initialState, 'old progress\rnew progress\n')).toMatchObject({
    lines: ['new progress'],
    pendingLine: '',
  });
});

it('removes only the line-ending CR when the line ends in CRCRLF', () => {
  expect(append(initialState, 'progress\r\r\n')).toMatchObject({
    lines: ['progress'],
    pendingLine: '',
  });
});

it('keeps visible text before a trailing carriage return', () => {
  expect(overwriteCarriageReturns('progress\r')).toBe('progress');
});

it('overlays a shorter redraw onto the existing line', () => {
  expect(append(initialState, 'old progress\rnew\n')).toMatchObject({
    lines: ['new progress'],
    pendingLine: '',
  });
});

it('reassembles a CRLF split across chunks', () => {
  const afterCarriageReturn = append(initialState, 'VISIBLE_MARKER_123\r');
  expect(afterCarriageReturn).toMatchObject({
    lines: [],
    pendingLine: 'VISIBLE_MARKER_123\r',
  });

  expect(append(afterCarriageReturn, '\n')).toMatchObject({
    lines: ['VISIBLE_MARKER_123'],
    pendingLine: '',
  });
});

it('bounds a newline-free carriage-return spinner to its longest segment', () => {
  let state = initialState;
  for (const segment of ['spinner 100%', 'spinner 99%', 'spinner 9%', 'spinner 1%']) {
    state = append(state, `${segment}\r`);
  }

  expect(state.pendingLine.length).toBeLessThanOrEqual('spinner 100%\r'.length);
  expect(overwriteCarriageReturns(state.pendingLine).length).toBeLessThanOrEqual('spinner 100%'.length);
});
