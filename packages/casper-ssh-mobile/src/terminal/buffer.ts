import { AnsiSpan, AnsiStyle, parseAnsiLine, stripTerminalControls } from './ansi';

export interface TerminalBufferState {
  pendingLine: string;
  style: AnsiStyle;
}

export interface TerminalBufferResult {
  lines: AnsiSpan[][];
  pendingLine: string;
  style: AnsiStyle;
}

export function overwriteCarriageReturns(input: string): string {
  return input
    .split('\r')
    .reduce((line, segment) => segment + line.slice(segment.length), '');
}

export function appendTerminalInput(
  state: TerminalBufferState,
  value: string,
): TerminalBufferResult {
  if (!value) {
    return { lines: [], pendingLine: state.pendingLine, style: state.style };
  }

  const input = stripTerminalControls(`${state.pendingLine}${value}`);
  const lines: AnsiSpan[][] = [];
  let start = 0;
  let newlineIndex = input.indexOf('\n');
  let style = state.style;

  while (newlineIndex >= 0) {
    const rawLine = input.slice(start, newlineIndex);
    const lineWithoutTerminator = rawLine.endsWith('\r')
      ? rawLine.slice(0, -1)
      : rawLine;
    const visibleLine = overwriteCarriageReturns(lineWithoutTerminator);
    const parsed = parseAnsiLine(visibleLine, style);
    lines.push(parsed.spans);
    style = parsed.style;
    start = newlineIndex + 1;
    newlineIndex = input.indexOf('\n', start);
  }

  const rawPendingLine = input.slice(start);
  const pendingLine = `${overwriteCarriageReturns(rawPendingLine)}${
    rawPendingLine.endsWith('\r') ? '\r' : ''
  }`;

  return { lines, pendingLine, style };
}
