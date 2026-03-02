/**
 * Safe child process wrapper.
 *
 * ALL external tool invocations go through this module.
 * Uses execFile (argv array) — never exec(string) — to prevent shell injection.
 * Output is capped, timeouts are enforced, and errors never throw.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecResult } from './types.js';

const execFileAsync = promisify(execFile);

/** Default timeout: 60 seconds */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Default max output: 50 MB */
const DEFAULT_MAX_OUTPUT = 50 * 1024 * 1024;

export interface ExecToolOptions {
  /** Timeout in milliseconds. Default: 60000 */
  timeout?: number;
  /** Working directory for the child process */
  cwd?: string;
  /** Maximum bytes for stdout/stderr before truncation. Default: 50 MB */
  maxOutput?: number;
}

/**
 * Execute an external tool safely.
 *
 * - Uses execFile with an argv array (no shell interpolation).
 * - Enforces a timeout and kills the process if exceeded.
 * - Caps stdout/stderr at maxOutput bytes.
 * - NEVER throws — always returns an ExecResult.
 */
export async function execTool(
  tool: string,
  args: string[],
  options?: ExecToolOptions,
): Promise<ExecResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxOutput = options?.maxOutput ?? DEFAULT_MAX_OUTPUT;

  try {
    const { stdout, stderr } = await execFileAsync(tool, args, {
      timeout,
      cwd: options?.cwd,
      maxBuffer: maxOutput,
      killSignal: 'SIGKILL',
    });

    return {
      stdout: truncate(stdout, maxOutput),
      stderr: truncate(stderr, maxOutput),
      exitCode: 0,
      timedOut: false,
    };
  } catch (err: unknown) {
    return handleExecError(err, maxOutput);
  }
}

/**
 * Check whether a tool is available on $PATH.
 *
 * Runs `which <name>` and returns true if it exits 0.
 */
export async function checkTool(name: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('which', [name], {
      timeout: 5_000,
    });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Truncate a string to at most maxBytes bytes (UTF-8). */
function truncate(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, 'utf-8');
  if (buf.byteLength <= maxBytes) {
    return value;
  }
  return buf.subarray(0, maxBytes).toString('utf-8');
}

/**
 * Map an execFile rejection into a safe ExecResult.
 *
 * Node's child_process errors come in two shapes:
 * 1. Process ran but exited non-zero → error has .code (exit code), .stdout, .stderr
 * 2. Process could not start → error has .code (string like 'ENOENT')
 *
 * For timeouts, Node sets error.killed = true when the process was killed
 * due to the timeout option.
 */
function handleExecError(err: unknown, maxBytes: number): ExecResult {
  // Node child_process errors carry extra properties not in the TS typings.
  const e = err as {
    code?: string | number;
    killed?: boolean;
    stdout?: string;
    stderr?: string;
    message?: string;
  };

  const stdout = truncate(e.stdout ?? '', maxBytes);
  const stderr = truncate(e.stderr ?? e.message ?? '', maxBytes);

  // Timeout: Node kills the process and sets killed = true.
  if (e.killed) {
    return {
      stdout,
      stderr,
      exitCode: -1,
      timedOut: true,
    };
  }

  // Process exited with a numeric exit code.
  if (typeof e.code === 'number') {
    return {
      stdout,
      stderr,
      exitCode: e.code,
      timedOut: false,
    };
  }

  // Could not start (ENOENT, EACCES, etc.) — use exit code 127 (command not found convention).
  return {
    stdout,
    stderr,
    exitCode: 127,
    timedOut: false,
  };
}
