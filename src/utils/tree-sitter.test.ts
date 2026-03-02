import { describe, it, expect, beforeAll } from 'vitest';
import {
  initTreeSitter,
  createParser,
  parseSource,
  getLanguageForExtension,
} from './tree-sitter.js';

beforeAll(async () => {
  await initTreeSitter();
});

describe('initTreeSitter', () => {
  it('does not throw on first call', async () => {
    // Already called in beforeAll — calling again to verify idempotency.
    await expect(initTreeSitter()).resolves.toBeUndefined();
  });

  it('is safe to call multiple times', async () => {
    await initTreeSitter();
    await initTreeSitter();
    // No error means success.
  });
});

describe('createParser', () => {
  it('returns a parser for typescript', async () => {
    const parser = await createParser('typescript');
    expect(parser).not.toBeNull();
  });

  it('returns a parser for tsx', async () => {
    const parser = await createParser('tsx');
    expect(parser).not.toBeNull();
  });

  it('returns a parser for javascript', async () => {
    const parser = await createParser('javascript');
    expect(parser).not.toBeNull();
  });

  it('returns a parser for python', async () => {
    const parser = await createParser('python');
    expect(parser).not.toBeNull();
  });

  it('returns a parser for go', async () => {
    const parser = await createParser('go');
    expect(parser).not.toBeNull();
  });

  it('returns null for unsupported language', async () => {
    const parser = await createParser('not-a-real-language');
    expect(parser).toBeNull();
  });

  it('returns the same cached instance on repeated calls', async () => {
    const first = await createParser('typescript');
    const second = await createParser('typescript');
    expect(first).toBe(second);
  });
});

describe('parseSource', () => {
  it('parses a simple TypeScript function', async () => {
    const source = 'function hello() { return 1; }';
    const tree = await parseSource(source, 'typescript');

    expect(tree).not.toBeNull();
    expect(tree!.rootNode).toBeDefined();
    expect(tree!.rootNode.childCount).toBeGreaterThan(0);
  });

  it('root node type is "program" for TypeScript', async () => {
    const tree = await parseSource('const x = 42;', 'typescript');
    expect(tree).not.toBeNull();
    expect(tree!.rootNode.type).toBe('program');
  });

  it('parses a Python function', async () => {
    const source = 'def greet(name):\n    return f"Hello {name}"';
    const tree = await parseSource(source, 'python');

    expect(tree).not.toBeNull();
    expect(tree!.rootNode.type).toBe('module');
    expect(tree!.rootNode.childCount).toBeGreaterThan(0);
  });

  it('parses a Go function', async () => {
    const source = 'package main\n\nfunc main() {}';
    const tree = await parseSource(source, 'go');

    expect(tree).not.toBeNull();
    expect(tree!.rootNode.type).toBe('source_file');
  });

  it('returns null for unsupported language', async () => {
    const tree = await parseSource('some code', 'not-a-real-language');
    expect(tree).toBeNull();
  });
});

describe('getLanguageForExtension', () => {
  it('maps .ts to typescript', () => {
    expect(getLanguageForExtension('.ts')).toBe('typescript');
  });

  it('maps .tsx to tsx', () => {
    expect(getLanguageForExtension('.tsx')).toBe('tsx');
  });

  it('maps .js to javascript', () => {
    expect(getLanguageForExtension('.js')).toBe('javascript');
  });

  it('maps .mjs to javascript', () => {
    expect(getLanguageForExtension('.mjs')).toBe('javascript');
  });

  it('maps .cjs to javascript', () => {
    expect(getLanguageForExtension('.cjs')).toBe('javascript');
  });

  it('maps .py to python', () => {
    expect(getLanguageForExtension('.py')).toBe('python');
  });

  it('maps .go to go', () => {
    expect(getLanguageForExtension('.go')).toBe('go');
  });

  it('returns null for unknown extension', () => {
    expect(getLanguageForExtension('.rs')).toBeNull();
  });

  it('returns null for extension without dot', () => {
    expect(getLanguageForExtension('ts')).toBeNull();
  });
});
