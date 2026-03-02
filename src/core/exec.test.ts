import { describe, it, expect } from 'vitest';
import { execTool, checkTool } from './exec.js';

describe('checkTool', () => {
  it('returns true for a tool that exists (node)', async () => {
    const result = await checkTool('node');
    expect(result).toBe(true);
  });

  it('returns false for a tool that does not exist', async () => {
    const result = await checkTool('definitely-not-a-real-tool-xyz');
    expect(result).toBe(false);
  });
});

describe('execTool', () => {
  it('captures stdout, exitCode 0 for echo', async () => {
    const result = await execTool('echo', ['hello']);
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('returns timedOut: true when process exceeds timeout', async () => {
    const result = await execTool('sleep', ['10'], { timeout: 100 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(-1);
  });

  it('returns non-zero exitCode for a tool that does not exist', async () => {
    const result = await execTool('definitely-not-a-real-tool-xyz', []);
    expect(result.exitCode).not.toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('captures stderr from a failing command', async () => {
    const result = await execTool('ls', ['--totally-invalid-flag-xyz']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('respects cwd option', async () => {
    const result = await execTool('pwd', [], { cwd: '/tmp' });
    expect(result.exitCode).toBe(0);
    // macOS may resolve /tmp -> /private/tmp
    expect(result.stdout.trim()).toMatch(/\/tmp$/);
  });

  it('never throws, even on catastrophic errors', async () => {
    // Empty string as tool name — should not throw
    const result = await execTool('', []);
    expect(result).toHaveProperty('exitCode');
    expect(result).toHaveProperty('timedOut');
    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
  });
});
