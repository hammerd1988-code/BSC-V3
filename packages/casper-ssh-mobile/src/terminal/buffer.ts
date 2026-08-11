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

interface StyledCell {
  text: string;
  style: AnsiStyle;
}

interface OverlayResult {
  text: string;
  style: AnsiStyle;
}

const COLORS: Record<string, number> = {
  '#111827': 30,
  '#f87171': 31,
  '#4ade80': 32,
  '#facc15': 33,
  '#60a5fa': 34,
  '#e879f9': 35,
  '#22d3ee': 36,
  '#e5e7eb': 37,
  '#6b7280': 90,
  '#fb7185': 91,
  '#86efac': 92,
  '#fde047': 93,
  '#93c5fd': 94,
  '#f0abfc': 95,
  '#67e8f9': 96,
  '#f9fafb': 97,
};

const BACKGROUNDS: Record<string, number> = {
  '#111827': 40,
  '#7f1d1d': 41,
  '#14532d': 42,
  '#713f12': 43,
  '#1e3a8a': 44,
  '#581c87': 45,
  '#164e63': 46,
  '#e5e7eb': 47,
  '#4b5563': 100,
  '#be123c': 101,
  '#166534': 102,
  '#a16207': 103,
  '#1d4ed8': 104,
  '#7e22ce': 105,
  '#0e7490': 106,
  '#f3f4f6': 107,
};

function sameStyle(left: AnsiStyle, right: AnsiStyle): boolean {
  return left.color === right.color
    && left.backgroundColor === right.backgroundColor
    && left.bold === right.bold
    && left.dim === right.dim
    && left.underline === right.underline;
}

function styleCodes(style: AnsiStyle): number[] {
  const codes: number[] = [];
  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.underline) codes.push(4);
  if (style.color && COLORS[style.color]) codes.push(COLORS[style.color]);
  if (style.backgroundColor && BACKGROUNDS[style.backgroundColor]) {
    codes.push(BACKGROUNDS[style.backgroundColor]);
  }
  return codes;
}

function serializeCells(cells: StyledCell[]): string {
  let output = '';
  let currentStyle: AnsiStyle = {};
  for (const cell of cells) {
    if (!sameStyle(currentStyle, cell.style)) {
      const codes = styleCodes(cell.style);
      output += `\u001b[${codes.length ? codes.join(';') : '0'}m`;
      currentStyle = cell.style;
    }
    output += cell.text;
  }
  return output;
}

function overlayCarriageReturns(input: string, initialStyle: AnsiStyle): OverlayResult {
  let cells: StyledCell[] = [];
  let style = initialStyle;
  for (const segment of input.split('\r')) {
    const parsed = parseAnsiLine(segment, style);
    const segmentCells = parsed.spans
      .filter((span) => span.text)
      .flatMap((span) => Array.from(span.text, (text) => ({ text, style: span.style })));
    cells = [...segmentCells, ...cells.slice(segmentCells.length)];
    style = parsed.style;
  }
  return { text: serializeCells(cells), style };
}

export function overwriteCarriageReturns(input: string): string {
  return overlayCarriageReturns(input, {}).text;
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
    const overlaid = overlayCarriageReturns(lineWithoutTerminator, style);
    const parsed = parseAnsiLine(overlaid.text, style);
    lines.push(parsed.spans);
    style = overlaid.style;
    start = newlineIndex + 1;
    newlineIndex = input.indexOf('\n', start);
  }

  const rawPendingLine = input.slice(start);
  const overlaidPending = overlayCarriageReturns(rawPendingLine, style);
  const pendingLine = `${overlaidPending.text}${
    rawPendingLine.endsWith('\r') ? '\r' : ''
  }`;
  style = overlaidPending.style;

  return { lines, pendingLine, style };
}
