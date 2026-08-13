export interface AnsiStyle {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}

export interface AnsiSpan {
  text: string;
  style: AnsiStyle;
}

export interface AnsiLineResult {
  spans: AnsiSpan[];
  style: AnsiStyle;
}

export type AnsiToken =
  | { type: 'text'; text: string; style: AnsiStyle }
  | { type: 'sgr'; codes: number[]; style: AnsiStyle }
  | { type: 'erase'; mode: number; style: AnsiStyle }
  | { type: 'drop'; style: AnsiStyle };

export interface AnsiTokenResult {
  tokens: AnsiToken[];
  style: AnsiStyle;
  remainder: string;
  discardingEscape: DiscardingEscape;
}

export type DiscardingEscape = 'csi' | 'osc' | 'osc-escape' | null;

const MAX_INCOMPLETE_ESCAPE_LENGTH = 64;

const COLORS: Record<number, string> = {
  30: '#111827', 31: '#f87171', 32: '#4ade80', 33: '#facc15',
  34: '#60a5fa', 35: '#e879f9', 36: '#22d3ee', 37: '#e5e7eb',
  90: '#6b7280', 91: '#fb7185', 92: '#86efac', 93: '#fde047',
  94: '#93c5fd', 95: '#f0abfc', 96: '#67e8f9', 97: '#f9fafb',
};

const BACKGROUNDS: Record<number, string> = {
  40: '#111827', 41: '#7f1d1d', 42: '#14532d', 43: '#713f12',
  44: '#1e3a8a', 45: '#581c87', 46: '#164e63', 47: '#e5e7eb',
  100: '#4b5563', 101: '#be123c', 102: '#166534', 103: '#a16207',
  104: '#1d4ed8', 105: '#7e22ce', 106: '#0e7490', 107: '#f3f4f6',
};

const CSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function pushText(tokens: AnsiToken[], text: string, style: AnsiStyle): void {
  if (!text) return;
  const previous = tokens[tokens.length - 1];
  if (previous?.type === 'text' && sameStyle(previous.style, style)) {
    previous.text += text;
  } else {
    tokens.push({ type: 'text', text, style: { ...style } });
  }
}

function sameStyle(left: AnsiStyle, right: AnsiStyle): boolean {
  return left.color === right.color
    && left.backgroundColor === right.backgroundColor
    && left.bold === right.bold
    && left.dim === right.dim
    && left.underline === right.underline;
}

export function applySgrCodes(initialStyle: AnsiStyle, codes: number[]): AnsiStyle {
  let style = { ...initialStyle };
  codes.forEach((code) => {
    if (code === 0) style = {};
    else if (code === 1) style = { ...style, bold: true };
    else if (code === 2) style = { ...style, dim: true };
    else if (code === 4) style = { ...style, underline: true };
    else if (code === 22) {
      const { bold: _bold, dim: _dim, ...rest } = style;
      style = rest;
    } else if (code === 24) {
      const { underline: _underline, ...rest } = style;
      style = rest;
    } else if (code === 39) {
      const { color: _color, ...rest } = style;
      style = rest;
    } else if (code === 49) {
      const { backgroundColor: _backgroundColor, ...rest } = style;
      style = rest;
    } else if (COLORS[code]) style = { ...style, color: COLORS[code] };
    else if (BACKGROUNDS[code]) style = { ...style, backgroundColor: BACKGROUNDS[code] };
  });
  return style;
}

function incompleteEscape(
  input: string,
  start: number,
  kind: 'csi' | 'osc',
): { remainder: string; discardingEscape: DiscardingEscape } {
  const candidate = input.slice(start);
  if (candidate.length <= MAX_INCOMPLETE_ESCAPE_LENGTH) {
    return { remainder: candidate, discardingEscape: null };
  }
  return {
    remainder: '',
    discardingEscape: kind === 'osc' && candidate.endsWith('\u001b')
      ? 'osc-escape'
      : kind,
  };
}

function isCsiFinal(character: string): boolean {
  const code = character.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
}

function parseMode(parameters: string): number {
  const mode = Number.parseInt(parameters.split(';')[0] || '0', 10);
  return Number.isFinite(mode) ? mode : 0;
}

export function tokenizeAnsi(
  input: string,
  initialStyle: AnsiStyle = {},
  initialDiscardingEscape: DiscardingEscape = null,
): AnsiTokenResult {
  const tokens: AnsiToken[] = [];
  let style = { ...initialStyle };
  let index = 0;
  let discardingEscape = initialDiscardingEscape;

  while (index < input.length) {
    if (discardingEscape === 'csi') {
      let end = index;
      while (end < input.length && !isCsiFinal(input[end])) end += 1;
      if (end >= input.length) {
        return { tokens, style, remainder: '', discardingEscape };
      }
      index = end + 1;
      discardingEscape = null;
      continue;
    }

    if (discardingEscape === 'osc-escape') {
      if (input[index] === '\\') {
        index += 1;
        discardingEscape = null;
        continue;
      }
      discardingEscape = 'osc';
    }

    if (discardingEscape === 'osc') {
      let end = index;
      while (end < input.length) {
        if (input[end] === '\u0007') {
          index = end + 1;
          discardingEscape = null;
          break;
        }
        if (input[end] === '\u001b') {
          if (end + 1 >= input.length) {
            return { tokens, style, remainder: '', discardingEscape: 'osc-escape' };
          }
          if (input[end + 1] === '\\') {
            index = end + 2;
            discardingEscape = null;
            break;
          }
        }
        end += 1;
      }
      if (discardingEscape === 'osc') {
        return { tokens, style, remainder: '', discardingEscape };
      }
      continue;
    }

    if (input[index] !== '\u001b') {
      const nextEscape = input.indexOf('\u001b', index);
      const end = nextEscape < 0 ? input.length : nextEscape;
      pushText(tokens, input.slice(index, end), style);
      index = end;
      continue;
    }

    if (index + 1 >= input.length) {
      const incomplete = input.slice(index);
      return {
        tokens,
        style,
        remainder: incomplete,
        discardingEscape: null,
      };
    }

    const kind = input[index + 1];
    if (kind === '[') {
      let end = index + 2;
      while (end < input.length && !isCsiFinal(input[end])) end += 1;
      if (end >= input.length) {
        const incomplete = incompleteEscape(input, index, 'csi');
        return { tokens, style, ...incomplete };
      }

      const parameters = input.slice(index + 2, end);
      const final = input[end];
      if (final === 'm') {
        const codes = parameters
          ? parameters.split(';').map((code) => Number.parseInt(code, 10))
          : [0];
        const validCodes = codes.filter(Number.isFinite);
        style = applySgrCodes(style, validCodes);
        tokens.push({ type: 'sgr', codes: validCodes, style: { ...style } });
      } else if (final === 'K') {
        tokens.push({ type: 'erase', mode: parseMode(parameters), style: { ...style } });
      } else {
        tokens.push({ type: 'drop', style: { ...style } });
      }
      index = end + 1;
      continue;
    }

    if (kind === ']') {
      let end = index + 2;
      let terminated = false;
      while (end < input.length) {
        if (input[end] === '\u0007') {
          end += 1;
          terminated = true;
          break;
        }
        if (input[end] === '\u001b' && input[end + 1] === '\\') {
          end += 2;
          terminated = true;
          break;
        }
        end += 1;
      }
      if (!terminated) {
        const incomplete = incompleteEscape(input, index, 'osc');
        return { tokens, style, ...incomplete };
      }
      index = end;
      continue;
    }

    if (kind === '(' || kind === ')') {
      if (index + 2 >= input.length) {
        return { tokens, style, remainder: input.slice(index), discardingEscape: null };
      }
      index += 3;
      continue;
    }

    index += 2;
  }

  return { tokens, style, remainder: '', discardingEscape };
}

export function parseAnsiLine(input: string, initialStyle: AnsiStyle = {}): AnsiLineResult {
  const result = tokenizeAnsi(input, initialStyle);
  const spans: AnsiSpan[] = [];
  result.tokens.forEach((token) => {
    if (token.type !== 'text') return;
    const previous = spans[spans.length - 1];
    if (previous && sameStyle(previous.style, token.style)) previous.text += token.text;
    else spans.push({ text: token.text, style: { ...token.style } });
  });
  if (result.remainder) {
    const previous = spans[spans.length - 1];
    if (previous && sameStyle(previous.style, result.style)) previous.text += result.remainder;
    else spans.push({ text: result.remainder, style: { ...result.style } });
  }
  return { spans: spans.length ? spans : [{ text: '', style: { ...result.style } }], style: result.style };
}

export function stripTerminalControls(input: string): string {
  return input
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[()][0-2A-Z]/g, '')
    .replace(CSI_PATTERN, (sequence) => sequence.endsWith('m') ? sequence : '');
}
