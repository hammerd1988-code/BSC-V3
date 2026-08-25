import { AnsiSpan, AnsiStyle, DiscardingEscape, tokenizeAnsi } from './ansi';

export interface TerminalBufferState {
  pendingLine: AnsiSpan[];
  cursorColumn: number;
  style: AnsiStyle;
  escapeRemainder: string;
  discardingEscape: DiscardingEscape;
  discardingEscapeBytes: number;
}

export interface TerminalBufferResult {
  lines: AnsiSpan[][];
  pendingLine: AnsiSpan[];
  cursorColumn: number;
  style: AnsiStyle;
  escapeRemainder: string;
  discardingEscape: DiscardingEscape;
  discardingEscapeBytes: number;
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
      escapeRemainder: state.escapeRemainder,
      discardingEscape: state.discardingEscape,
      discardingEscapeBytes: state.discardingEscapeBytes,
    };
  }

  const parsed = tokenizeAnsi(
    `${state.escapeRemainder}${value}`,
    state.style,
    state.discardingEscape,
    state.discardingEscapeBytes,
  );
  const lines: AnsiSpan[][] = [];
  const cells = state.pendingLine.flatMap((span) =>
    Array.from(span.text, (text) => ({ text, style: { ...span.style } })),
  );
  let cursorColumn = state.cursorColumn;

  for (const token of parsed.tokens) {
    if (token.type === 'erase') {
      const eraseStyle = token.style;
      if (token.mode === 0) {
        cells.length = Math.min(cursorColumn, cells.length);
      } else if (token.mode === 1) {
        while (cells.length < cursorColumn) {
          cells.push({ text: ' ', style: { ...eraseStyle } });
        }
        for (let column = 0; column <= cursorColumn; column += 1) {
          cells[column] = { text: ' ', style: { ...eraseStyle } };
        }
      } else if (token.mode === 2) {
        cells.length = 0;
      }
      continue;
    }

    if (token.type !== 'text') continue;

    for (const character of Array.from(token.text)) {
      if (character === '\r') {
        cursorColumn = 0;
      } else if (character === '\n') {
        lines.push(cellsToSpans(cells));
        cells.length = 0;
        cursorColumn = 0;
      } else {
        while (cells.length < cursorColumn) {
          cells.push({ text: ' ', style: { ...token.style } });
        }
        const existing = cells[cursorColumn];
        if (existing) {
          existing.text = character;
          existing.style = { ...token.style };
        } else {
          cells.push({ text: character, style: { ...token.style } });
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
    escapeRemainder: parsed.remainder,
    discardingEscape: parsed.discardingEscape,
    discardingEscapeBytes: parsed.discardingEscapeBytes,
  };
}
