/**
 * Minimal syntax tokenizer for code/pseudocode rendering inside text nodes.
 *
 * Zero dependencies. Three flavors:
 *   - 'pseudo'      — algorithm pseudocode (CS-textbook style)
 *   - 'python'      — Python keywords + comment style (#)
 *   - 'javascript'  — JS keywords + comment style (//)
 *
 * Each tokenize* function takes a single line and returns the colored ranges.
 * Plain text (whitespace, operators, punctuation) is NOT in the result — the
 * renderer fills the gaps with the default text color. This keeps the
 * tokenizer tiny and the rendering simple.
 */

export type SyntaxStyle = 'none' | 'pseudo' | 'python' | 'javascript';

export type TokenKind =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'function';

export type Token = {
  start: number; // inclusive
  end: number; // exclusive
  kind: TokenKind;
};

// Common to all flavors — generic algorithm vocabulary
const PSEUDO_KEYWORDS = new Set([
  'if', 'else', 'elif', 'then', 'end', 'endif', 'endfor', 'endwhile',
  'for', 'foreach', 'while', 'do', 'until', 'repeat',
  'return', 'break', 'continue', 'pass', 'yield',
  'let', 'set', 'var', 'const',
  'function', 'def', 'procedure', 'algorithm', 'fn',
  'and', 'or', 'not', 'xor', 'in', 'of', 'to', 'from', 'by', 'is',
  'true', 'false', 'null', 'nil', 'None', 'True', 'False',
  'swap', 'min', 'max', 'len', 'length', 'size', 'print', 'output',
  'new', 'array', 'list', 'queue', 'stack', 'map', 'set',
  'class', 'this', 'self',
]);

const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
  'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
  'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
  'while', 'with', 'yield', 'self', 'cls',
]);

const JS_KEYWORDS = new Set([
  'var', 'let', 'const', 'function', 'return', 'if', 'else', 'for',
  'while', 'do', 'break', 'continue', 'switch', 'case', 'default',
  'class', 'extends', 'new', 'this', 'super', 'static', 'get', 'set',
  'import', 'export', 'from', 'as', 'try', 'catch', 'finally', 'throw',
  'true', 'false', 'null', 'undefined', 'typeof', 'instanceof', 'in', 'of',
  'async', 'await', 'yield', 'void', 'delete',
]);

const IDENT_START = /[a-zA-Z_$]/;
const IDENT_BODY = /[a-zA-Z0-9_$]/;
const DIGIT = /[0-9]/;

function tokenizeLine(
  line: string,
  keywords: Set<string>,
  lineCommentMarkers: string[]
): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;

  while (i < n) {
    // Line comment — consumes rest of line
    let isComment = false;
    for (const marker of lineCommentMarkers) {
      if (line.startsWith(marker, i)) {
        tokens.push({ start: i, end: n, kind: 'comment' });
        return tokens;
      }
    }
    if (isComment) break;

    const c = line[i];

    // String literal (single or double quote, simple — no interpolation)
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      const start = i;
      i++;
      while (i < n && line[i] !== quote) {
        if (line[i] === '\\' && i + 1 < n) i += 2;
        else i++;
      }
      if (i < n) i++; // closing quote
      tokens.push({ start, end: i, kind: 'string' });
      continue;
    }

    // Number literal (integer or float, including negative not handled — '-' is operator)
    if (DIGIT.test(c)) {
      const start = i;
      while (i < n && (DIGIT.test(line[i]) || line[i] === '.')) i++;
      tokens.push({ start, end: i, kind: 'number' });
      continue;
    }

    // Identifier — could be keyword, function call, or plain
    if (IDENT_START.test(c)) {
      const start = i;
      while (i < n && IDENT_BODY.test(line[i])) i++;
      const word = line.slice(start, i);
      // Skip whitespace to peek for opening paren (function call)
      let j = i;
      while (j < n && line[j] === ' ') j++;
      const isCall = j < n && line[j] === '(';

      if (keywords.has(word)) {
        tokens.push({ start, end: i, kind: 'keyword' });
      } else if (isCall) {
        tokens.push({ start, end: i, kind: 'function' });
      }
      // Plain identifiers produce no token — renderer uses default color
      continue;
    }

    // Anything else (whitespace, punctuation, operators) — no token
    i++;
  }

  return tokens;
}

export function tokenize(line: string, style: SyntaxStyle): Token[] {
  switch (style) {
    case 'pseudo':
      return tokenizeLine(line, PSEUDO_KEYWORDS, ['#', '//']);
    case 'python':
      return tokenizeLine(line, PYTHON_KEYWORDS, ['#']);
    case 'javascript':
      return tokenizeLine(line, JS_KEYWORDS, ['//']);
    case 'none':
    default:
      return [];
  }
}

export type SyntaxColors = {
  keyword?: string;
  string?: string;
  comment?: string;
  number?: string;
  function?: string;
};

export const DEFAULT_SYNTAX_COLORS: Required<SyntaxColors> = {
  keyword: '#c084fc',  // purple
  string: '#86efac',   // green
  comment: '#64748b',  // slate gray
  number: '#fbbf24',   // amber
  function: '#60a5fa', // blue
};
