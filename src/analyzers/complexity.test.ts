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

// ── Python complexity ──────────────────────────────────────────────

/**
 * Helper: parse a Python source string and return the computed
 * complexity for the first (or only) function found.
 */
async function getFirstPythonFunctionComplexity(source: string): Promise<number> {
  const result = await computeFileComplexity(source, 'python', 'test.py');
  expect(result.functions.length).toBeGreaterThanOrEqual(1);
  return result.functions[0]!.complexity;
}

describe('Python complexity', () => {
  it('scores 1 for a simple Python function with no branches', async () => {
    const source = `
def hello():
    return 1
`;
    // base = 1, no decision points
    // Expected: 1
    const c = await getFirstPythonFunctionComplexity(source);
    expect(c).toBe(1);
  });

  it('scores correct complexity for if/elif/else (else=0, each if/elif=+1)', async () => {
    const source = `
def classify(x):
    if x > 100:
        return "huge"
    elif x > 50:
        return "big"
    elif x > 10:
        return "medium"
    else:
        return "small"
`;
    // base      = 1
    // if        = 1
    // elif #1   = 1 (each elif is a separate if_statement in the AST)
    // elif #2   = 1
    // else      = 0
    // Total     = 4
    const c = await getFirstPythonFunctionComplexity(source);
    expect(c).toBe(4);
  });

  it('scores +1 for for loop and +1 for list comprehension', async () => {
    const source = `
def process(items):
    result = []
    for item in items:
        result.append(item)
    squares = [x * x for x in items]
    return result + squares
`;
    // base              = 1
    // for               = 1
    // list_comprehension = 1
    // Total             = 3
    const c = await getFirstPythonFunctionComplexity(source);
    expect(c).toBe(3);
  });

  it('scores +1 for except clause in try/except', async () => {
    const source = `
def safe_divide(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        return None
`;
    // base    = 1
    // except  = 1
    // Total   = 2
    const c = await getFirstPythonFunctionComplexity(source);
    expect(c).toBe(2);
  });

  it('scores +1 each for and/or operators', async () => {
    const source = `
def check(a, b, c):
    return a and b or c
`;
    // base = 1
    // and  = 1
    // or   = 1
    // Total = 3
    const c = await getFirstPythonFunctionComplexity(source);
    expect(c).toBe(3);
  });

  it('scores +1 for Python ternary (conditional_expression)', async () => {
    const source = `
def abs_val(x):
    return x if x >= 0 else -x
`;
    // base                  = 1
    // conditional_expression = 1
    // Total                 = 2
    const c = await getFirstPythonFunctionComplexity(source);
    expect(c).toBe(2);
  });

  it('extracts function name from function_definition', async () => {
    const source = `
def my_function():
    pass
`;
    const result = await computeFileComplexity(source, 'python', 'test.py');
    expect(result.functions.length).toBe(1);
    expect(result.functions[0]!.name).toBe('my_function');
  });

  it('uses <lambda> for lambda expressions', async () => {
    const source = `
double = lambda x: x * 2
`;
    const result = await computeFileComplexity(source, 'python', 'test.py');
    expect(result.functions.length).toBe(1);
    expect(result.functions[0]!.name).toBe('<lambda>');
  });

  it('counts set/dict comprehensions and generator expressions', async () => {
    const source = `
def comprehensions(items):
    s = {x for x in items}
    d = {x: x for x in items}
    g = sum(x for x in items)
    return s, d, g
`;
    // base                      = 1
    // set_comprehension          = 1
    // dictionary_comprehension   = 1
    // generator_expression       = 1
    // Total                     = 4
    const c = await getFirstPythonFunctionComplexity(source);
    expect(c).toBe(4);
  });
});

// ── Go complexity ────────────────────────────────────────────────────

/**
 * Helper: parse a Go source string and return the computed
 * complexity for the first (or only) function found.
 */
async function getFirstGoFunctionComplexity(source: string): Promise<number> {
  const result = await computeFileComplexity(source, 'go', 'test.go');
  expect(result.functions.length).toBeGreaterThanOrEqual(1);
  return result.functions[0]!.complexity;
}

describe('Go complexity', () => {
  it('scores 1 for a simple Go function with no branches', async () => {
    const source = `
package main

func hello() int {
    return 1
}
`;
    // base = 1, no decision points
    // Expected: 1
    const c = await getFirstGoFunctionComplexity(source);
    expect(c).toBe(1);
  });

  it('scores 2 for a Go function with if/else (else=0)', async () => {
    const source = `
package main

func check(x int) string {
    if x > 0 {
        return "positive"
    } else {
        return "non-positive"
    }
}
`;
    // base = 1
    // if   = 1
    // else = 0
    // Total = 2
    const c = await getFirstGoFunctionComplexity(source);
    expect(c).toBe(2);
  });

  it('scores +1 for a for loop', async () => {
    const source = `
package main

func sum(nums []int) int {
    total := 0
    for _, n := range nums {
        total += n
    }
    return total
}
`;
    // base = 1
    // for  = 1
    // Total = 2
    const c = await getFirstGoFunctionComplexity(source);
    expect(c).toBe(2);
  });

  it('scores +1 per case in switch (default does not count)', async () => {
    const source = `
package main

func grade(score int) string {
    switch {
    case score >= 90:
        return "A"
    case score >= 80:
        return "B"
    case score >= 70:
        return "C"
    default:
        return "F"
    }
}
`;
    // base    = 1
    // case    = 1 (score >= 90)
    // case    = 1 (score >= 80)
    // case    = 1 (score >= 70)
    // default = 0
    // Total   = 4
    const c = await getFirstGoFunctionComplexity(source);
    expect(c).toBe(4);
  });

  it('scores +1 each for && and || operators', async () => {
    const source = `
package main

func validate(a bool, b bool, c bool) bool {
    return a && b || c
}
`;
    // base = 1
    // &&   = 1
    // ||   = 1
    // Total = 3
    const c = await getFirstGoFunctionComplexity(source);
    expect(c).toBe(3);
  });

  it('extracts name from method_declaration', async () => {
    const source = `
package main

type MyStruct struct{}

func (s MyStruct) MyMethod() int {
    return 1
}
`;
    const result = await computeFileComplexity(source, 'go', 'test.go');
    expect(result.functions.length).toBe(1);
    expect(result.functions[0]!.name).toBe('MyMethod');
  });

  it('extracts name from func literal assigned with :=', async () => {
    const source = `
package main

func main() {
    add := func(a, b int) int {
        return a + b
    }
    _ = add
}
`;
    const result = await computeFileComplexity(source, 'go', 'test.go');
    // main + func literal
    const fnLiteral = result.functions.find((f) => f.name === 'add');
    expect(fnLiteral).toBeDefined();
    expect(fnLiteral!.complexity).toBe(1);
  });
});
