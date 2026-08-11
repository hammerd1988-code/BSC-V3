import { AnsiSpan, AnsiStyle, parseAnsiLine, stripTerminalControls } from './ansi';

export interface TerminalBufferState {
  pendingLine: AnsiSpan[];
  cursorColumn: number;
  style: AnsiStyle;
}

export interface TerminalBufferResult {
  lines: AnsiSpan[][];
  pendingLine: AnsiSpan[];
  cursorColumn: number;
  style: AnsiStyle;
}

function sameStyle(left: AnsiStyle, right: AnsiStyle): boolean {
  return left.color === right.color
    && left.backgroundColor === right.backgroundColor
    && left.bold === right.bold
    && left.dim === right.dim
    && left.underline === right.underline;
}

function appendSpan(spans: AnsiSpan[], text: string, style: AnsiStyle): void {
  if (!text) return;
  const previous = spans[spans.length - 1];
  if (previous && sameStyle(previous.style, style)) {
    previous.text += text;
  } else {
    spans.push({ text, style: { ...style } });
  }
}

function cellsToSpans(cells: AnsiSpan[]): AnsiSpan[] {
  return cells.reduce<AnsiSpan[]>((spans, span) => {
    appendSpan(spans, span.text, span.style);
    return spans;
  }, []);
}

export function appendTerminalInput(
  state: TerminalBufferState,
  value: string,
): TerminalBufferResult {
  if (!value) {
    return {
      lines: [],
      pendingLine: state.pendingLine,
      cursorColumn: state.cursorColumn,
      style: state.style,
    };
  }

  const parsed = parseAnsiLine(stripTerminalControls(value), state.style);
  const lines: AnsiSpan[][] = [];
  const cells = state.pendingLine.map((span) => ({ ...span, style: { ...span.style } }));
  let cursorColumn = state.cursorColumn;

  for (const span of parsed.spans) {
    for (const character of Array.from(span.text)) {
      if (character === '\r') {
        cursorColumn = 0;
      } else if (character === '\n') {
        lines.push(cellsToSpans(cells));
        cells.length = 0;
        cursorColumn = 0;
      } else {
        const existing = cells[cursorColumn];
        if (existing) {
          existing.text = character;
          existing.style = { ...span.style };
        } else {
          cells[cursorColumn] = { text: character, style: { ...span.style } };
        }
        cursorColumn += 1;
      }
    }
  }

  return {
    lines,
    pendingLine: cellsToSpans(cells),
    cursorColumn,
    style: parsed.style,
  };
}
