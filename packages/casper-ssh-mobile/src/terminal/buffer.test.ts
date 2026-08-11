import { appendTerminalInput, TerminalBufferState } from './buffer';
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
    lines: [''],
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
