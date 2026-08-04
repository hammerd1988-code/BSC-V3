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

export function parseAnsiLine(input: string, initialStyle: AnsiStyle = {}): AnsiLineResult {
  const spans: AnsiSpan[] = [];
  let style: AnsiStyle = { ...initialStyle };
  let cursor = 0;
  const pattern = /\u001b\[([0-9;?]*)([ -/]*)([@-~])/g;

  const pushText = (text: string) => {
    if (!text) return;
    const previous = spans[spans.length - 1];
    if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) {
      previous.text += text;
    } else {
      spans.push({ text, style: { ...style } });
    }
  };

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) {
    pushText(input.slice(cursor, match.index));
    cursor = pattern.lastIndex;
    if (match[3] !== 'm') continue;
    const codes = match[1] ? match[1].split(';').map(Number) : [0];
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
  }
  pushText(input.slice(cursor));
  return { spans: spans.length ? spans : [{ text: '', style: { ...style } }], style };
}

export function stripTerminalControls(input: string): string {
  return input
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[()][0-2A-Z]/g, '')
    .replace(CSI_PATTERN, (sequence) => sequence.endsWith('m') ? sequence : '');
}
