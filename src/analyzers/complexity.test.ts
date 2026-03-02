/**
 * Unit tests for McCabe cyclomatic complexity analyzer.
 *
 * Each test case includes a hand-computed expected complexity based on
 * the rules in spec/metrics-v1.md. The source is parsed via tree-sitter
 * WASM and passed through computeFileComplexity.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { computeFileComplexity } from './complexity.js';
import { initTreeSitter } from '../utils/tree-sitter.js';

beforeAll(async () => {
  await initTreeSitter();
});

/**
 * Helper: parse a TypeScript source string and return the computed
 * complexity for the first (or only) function found.
 */
async function getFirstFunctionComplexity(source: string): Promise<number> {
  const result = await computeFileComplexity(source, 'typescript', 'test.ts');
  expect(result.functions.length).toBeGreaterThanOrEqual(1);
  return result.functions[0]!.complexity;
}

describe('McCabe cyclomatic complexity', () => {
  // ── Test 1: Trivial function ─────────────────────────────────────

  it('scores 1 for a simple function with no branches', async () => {
    const source = `function hello() { return 1; }`;
    // base = 1, no decision points
    // Expected: 1
    const c = await getFirstFunctionComplexity(source);
    expect(c).toBe(1);
  });

  // ── Test 2: Single if ────────────────────────────────────────────

  it('scores 2 for a function with a single if', async () => {
    const source = `function check(x: number) { if (x > 0) { return true; } return false; }`;
    // base = 1, if = 1
    // Expected: 2
    const c = await getFirstFunctionComplexity(source);
    expect(c).toBe(2);
  });

  // ── Test 3: If/else — else does NOT increment ────────────────────

  it('scores 2 for if/else (else does NOT increment)', async () => {
    const source = `function check(x: number) { if (x > 0) { return 'positive'; } else { return 'non-positive'; } }`;
    // base = 1, if = 1, else = 0
    // Expected: 2
    const c = await getFirstFunctionComplexity(source);
    expect(c).toBe(2);
  });

  // ── Test 4: Complex function with multiple constructs ────────────

  it('scores 7 for a function with if/&&/for/if/else-if/ternary', async () => {
    const source = `
function complex(x: number, y: number) {
  if (x > 0 && y > 0) {
    for (let i = 0; i < x; i++) {
      if (i % 2 === 0) { continue; }
    }
  } else if (x < 0) {
    return y > 0 ? -1 : 1;
  }
  return 0;
}`;
    // base      = 1
    // if        = 1
    // &&        = 1
    // for       = 1
    // inner if  = 1
    // else if   = 1 (the if inside the else clause)
    // ternary   = 1
    // Total     = 7
    const c = await getFirstFunctionComplexity(source);
    expect(c).toBe(7);
  });

  // ── Test 5: Switch with cases ────────────────────────────────────

  it('scores 4 for switch with 3 cases (default does not count)', async () => {
    const source = `
function grade(score: number) {
  switch(true) {
    case score >= 90: return 'A';
    case score >= 80: return 'B';
    case score >= 70: return 'C';
    default: return 'F';
  }
}`;
    // base    = 1
    // case    = 1 (score >= 90)
    // case    = 1 (score >= 80)
    // case    = 1 (score >= 70)
    // default = 0
    // Total   = 4
    const c = await getFirstFunctionComplexity(source);
    expect(c).toBe(4);
  });

  // ── Test 6: Logical operators ────────────────────────────────────

  it('scores 4 for a function with ||, &&, and ??', async () => {
    const source = `
function validate(a: any, b: any) {
  return (a || b) && (a ?? b);
}`;
    // base = 1
    // ||   = 1
    // &&   = 1
    // ??   = 1
    // Total = 4
    const c = await getFirstFunctionComplexity(source);
    expect(c).toBe(4);
  });

  // ── Test 7: Try/catch ────────────────────────────────────────────

  it('scores 2 for a function with try/catch', async () => {
    const source = `
function safe() {
  try { something(); } catch (e) { handle(); }
}`;
    // base  = 1
    // catch = 1
    // Total = 2
    const c = await getFirstFunctionComplexity(source);
    expect(c).toBe(2);
  });

  // ── Test 8: While and do-while ───────────────────────────────────

  it('scores 3 for a function with while and do-while', async () => {
    const source = `
function loops() {
  while (true) { break; }
  do { } while (false);
}`;
    // base     = 1
    // while    = 1
    // do-while = 1
    // Total    = 3
    const c = await getFirstFunctionComplexity(source);
    expect(c).toBe(3);
  });

  // ── Test 9: for...of / for...in ──────────────────────────────────

  it('scores 3 for a function with for...of and for...in', async () => {
    const source = `
function iterate(obj: Record<string, number>, arr: number[]) {
  for (const key in obj) { console.log(key); }
  for (const val of arr) { console.log(val); }
}`;
    // base     = 1
    // for...in = 1
    // for...of = 1
    // Total    = 3
    const c = await getFirstFunctionComplexity(source);
    expect(c).toBe(3);
  });

  // ── Test 10: Nested ternary ──────────────────────────────────────

  it('scores 3 for nested ternary operators', async () => {
    const source = `
function nested(x: number) {
  return x > 0 ? 'pos' : x < 0 ? 'neg' : 'zero';
}`;
    // base      = 1
    // ternary 1 = 1
    // ternary 2 = 1
    // Total     = 3
    const c = await getFirstFunctionComplexity(source);
    expect(c).toBe(3);
  });

  // ── Test 11: else-if chain ───────────────────────────────────────

  it('scores 4 for if / else-if / else-if / else chain', async () => {
    const source = `
function classify(x: number) {
  if (x > 100) {
    return 'huge';
  } else if (x > 50) {
    return 'big';
  } else if (x > 10) {
    return 'medium';
  } else {
    return 'small';
  }
}`;
    // base       = 1
    // if         = 1
    // else if #1 = 1 (the if inside else)
    // else if #2 = 1 (the if inside else)
    // else       = 0
    // Total      = 4
    const c = await getFirstFunctionComplexity(source);
    expect(c).toBe(4);
  });
});

describe('nested function handling', () => {
  it('counts inner function decision points separately from outer', async () => {
    const source = `
function outer(x: number) {
  if (x > 0) {
    const inner = () => {
      if (x > 10) { return 'big'; }
      return 'small';
    };
    return inner();
  }
  return 'none';
}`;
    // outer: base=1, if=1 => 2 (the inner arrow's if does NOT count)
    // inner: base=1, if=1 => 2
    const result = await computeFileComplexity(source, 'typescript', 'test.ts');
    expect(result.functionCount).toBe(2);

    const outer = result.functions.find((f) => f.name === 'outer');
    const inner = result.functions.find((f) => f.name === 'inner');

    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(outer!.complexity).toBe(2);
    expect(inner!.complexity).toBe(2);
  });
});

describe('function name extraction', () => {
  it('extracts names from various function forms', async () => {
    const source = `
function named() {}
const arrowConst = () => {};
const exprConst = function() {};
class MyClass {
  myMethod() {}
}
const obj = {
  objMethod() {},
  objArrow: () => {},
};
`;
    const result = await computeFileComplexity(source, 'typescript', 'test.ts');
    const names = result.functions.map((f) => f.name);

    expect(names).toContain('named');
    expect(names).toContain('arrowConst');
    expect(names).toContain('exprConst');
    expect(names).toContain('myMethod');
    expect(names).toContain('objMethod');
    expect(names).toContain('objArrow');
  });

  it('uses <anonymous> for unattributable arrow functions', async () => {
    const source = `[1,2,3].map((x) => x + 1);`;
    const result = await computeFileComplexity(source, 'typescript', 'test.ts');
    expect(result.functions.length).toBe(1);
    expect(result.functions[0]!.name).toBe('<anonymous>');
  });
});

describe('FileComplexity aggregation', () => {
  it('computes correct avg and max across multiple functions', async () => {
    const source = `
function simple() { return 1; }
function branchy(x: number) {
  if (x > 0) { return 1; }
  if (x < 0) { return -1; }
  return 0;
}`;
    // simple: complexity 1
    // branchy: base=1, if=1, if=1 => 3
    const result = await computeFileComplexity(source, 'typescript', 'test.ts');
    expect(result.functionCount).toBe(2);
    expect(result.maxComplexity).toBe(3);
    expect(result.avgComplexity).toBe(2); // (1 + 3) / 2
  });

  it('returns zero metrics for a file with no functions', async () => {
    const source = `const x = 42;\nconsole.log(x);\n`;
    const result = await computeFileComplexity(source, 'typescript', 'test.ts');
    expect(result.functionCount).toBe(0);
    expect(result.avgComplexity).toBe(0);
    expect(result.maxComplexity).toBe(0);
    expect(result.functions).toEqual([]);
  });
});

describe('line number extraction', () => {
  it('reports 1-based line numbers', async () => {
    const source = `
function first() {}
function second() {}
`;
    // first is on line 2 (1-indexed), second on line 3
    const result = await computeFileComplexity(source, 'typescript', 'test.ts');
    const first = result.functions.find((f) => f.name === 'first');
    const second = result.functions.find((f) => f.name === 'second');

    expect(first!.line).toBe(2);
    expect(second!.line).toBe(3);
  });
});
