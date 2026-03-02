/**
 * test-utils.ts — Shared test helpers for conditional skip logic.
 *
 * When tests are run via `bun test` (bun's native runner) instead of `vitest`,
 * vitest-specific features like `vi.mock()` pollute the shared module scope and
 * break integration tests that depend on real module behavior. This module
 * provides flags to detect the runtime environment so integration tests can
 * gracefully skip when the runner does not support vitest module isolation.
 */

/**
 * True when running under vitest (which sets process.env.VITEST = 'true').
 * False when running under bun's native test runner or other runners.
 */
export const IS_VITEST = process.env.VITEST === 'true';

/**
 * True when NOT running under vitest. Use with `describe.skipIf(SKIP_NON_VITEST)`
 * to skip integration tests that require vitest module isolation.
 */
export const SKIP_NON_VITEST = !IS_VITEST;
