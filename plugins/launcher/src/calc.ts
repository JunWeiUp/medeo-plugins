// Calculator: a small recursive-descent parser. Never `eval`; only numbers,
// operators, parentheses, the constants below and the functions below.
const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  ln: Math.log, log: Math.log10, log2: Math.log2, exp: Math.exp,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: 2 * Math.PI };

type Token = { kind: 'num'; value: number } | { kind: 'op'; value: string } | { kind: 'name'; value: string };

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  const text = input.replace(/[×xX](?=\s*[\d(.π])/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^');
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    const number = /^(\d[\d,_]*(\.\d*)?|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
    if (number) {
      // Thousands separators only between groups of three digits: "1,000" yes, "1,2" no.
      const raw = number[0];
      if (/,/.test(raw) && !/^\d{1,3}(,\d{3})+(\.|e|$)/i.test(raw)) return null;
      tokens.push({ kind: 'num', value: Number(raw.replace(/[,_]/g, '')) });
      i += raw.length; continue;
    }
    const name = /^[a-zπ][a-z0-9]*/i.exec(text.slice(i));
    if (name) { tokens.push({ kind: 'name', value: name[0].toLowerCase() }); i += name[0].length; continue; }
    if ('+-*/%^()!'.includes(c)) { tokens.push({ kind: 'op', value: c }); i++; continue; }
    return null;
  }
  return tokens;
}

class Parser {
  private at = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) { this.tokens = tokens; }
  parse(): number {
    const value = this.sum();
    if (this.at !== this.tokens.length) throw Error('trailing');
    return value;
  }
  private peek(): Token | undefined { return this.tokens[this.at]; }
  private op(value: string): boolean {
    const t = this.peek();
    if (t?.kind === 'op' && t.value === value) { this.at++; return true; }
    return false;
  }
  private sum(): number {
    let value = this.product();
    for (;;) {
      if (this.op('+')) value += this.product();
      else if (this.op('-')) value -= this.product();
      else return value;
    }
  }
  private product(): number {
    let value = this.unary();
    for (;;) {
      if (this.op('*')) value *= this.unary();
      else if (this.op('/')) value /= this.unary();
      else if (this.op('%')) value %= this.unary();
      // Implicit multiplication: "2pi", "3(4+1)", "(1+1)(2)".
      else if (this.peek()?.kind === 'name' || (this.peek()?.kind === 'op' && this.peek()!.value === '(')) value *= this.unary();
      else return value;
    }
  }
  private unary(): number {
    if (this.op('-')) return -this.unary();
    if (this.op('+')) return this.unary();
    return this.power();
  }
  private power(): number {
    const base = this.postfix();
    // Right-associative, and binds tighter than a leading minus on its right: 2^-1 = 0.5.
    if (this.op('^')) return base ** this.unary();
    return base;
  }
  private postfix(): number {
    let value = this.atom();
    while (this.op('!')) value = factorial(value);
    return value;
  }
  private atom(): number {
    const t = this.tokens[this.at++];
    if (!t) throw Error('end');
    if (t.kind === 'num') return t.value;
    if (t.kind === 'op' && t.value === '(') {
      const value = this.sum();
      if (!this.op(')')) throw Error('paren');
      return value;
    }
    if (t.kind === 'name') {
      if (t.value in CONSTANTS) return CONSTANTS[t.value];
      const fn = FUNCTIONS[t.value];
      if (fn) {
        if (this.op('(')) { const value = this.sum(); if (!this.op(')')) throw Error('paren'); return fn(value); }
        return fn(this.unary());
      }
    }
    throw Error('token');
  }
}
function factorial(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 170) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** The value of `input` when it is a calculation, otherwise null. A bare number is not one. */
export function calculate(input: string): number | null {
  const text = input.trim().replace(/=\s*$/, '');
  if (!text || text.length > 200) return null;
  const tokens = tokenize(text);
  if (!tokens || tokens.length < 2) return null;
  // Something to compute: an operator other than a lone leading sign, or a function/constant.
  const operative = tokens.some((t, i) => (t.kind === 'op' && !(i === 0 && (t.value === '-' || t.value === '+'))) || t.kind === 'name');
  if (!operative) return null;
  try {
    const value = new Parser(tokens).parse();
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
}

/** Up to 12 significant digits, no float noise ("0.1+0.2" → "0.3"), grouping left to the caller. */
export function formatNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e15 || abs < 1e-9) return value.toExponential(8).replace(/\.?0+e/, 'e').replace('e+', 'e');
  return String(Number(value.toPrecision(12)));
}
