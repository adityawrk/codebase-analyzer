/**
 * Git history analyzer — extracts commit history metrics from a git repository.
 *
 * All git commands are executed via exec.ts (execFile with argv, no shell interpolation).
 * Gracefully degrades when the repository is not a git repo.
 */

import type {
  RepositoryIndex,
  GitAnalysisResult,
  ContributorInfo,
  RecentCommit,
  AnalyzerMeta,
} from '../core/types.js';
import { execTool } from '../core/exec.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of top contributors to include in the result. */
const TOP_CONTRIBUTORS_LIMIT = 10;

/** Regex for conventional commit subjects. */
const CONVENTIONAL_COMMIT_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?:\s/;

/** Number of recent commit subjects to sample for conventional commit %. */
const CONVENTIONAL_SAMPLE_SIZE = 100;

/** Number of recent commits to display in the report. */
const RECENT_COMMITS_LIMIT = 15;

/** Minimum commit message length — shorter is "very short". */
const SHORT_MESSAGE_THRESHOLD = 10;

/** Regex patterns for test file paths. */
const TEST_FILE_RE = /(?:\.test\.|\.spec\.|__tests__\/)/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse `git shortlog -sne` output into ContributorInfo entries.
 *
 * Each line looks like:
 *   "    42\tJane Doe <jane@example.com>"
 */
function parseShortlog(stdout: string): ContributorInfo[] {
  const contributors: ContributorInfo[] = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // Format: "count\tName <email>"
    const tabIdx = trimmed.indexOf('\t');
    if (tabIdx === -1) continue;

    const count = parseInt(trimmed.slice(0, tabIdx).trim(), 10);
    if (isNaN(count)) continue;

    const rest = trimmed.slice(tabIdx + 1).trim();
    // Extract name and email from "Name <email>"
    const emailMatch = rest.match(/^(.+?)\s*<([^>]+)>$/);
    if (emailMatch) {
      contributors.push({
        name: emailMatch[1]!.trim(),
        email: emailMatch[2]!.trim(),
        commits: count,
      });
    } else {
      // No email found — use the whole rest as name
      contributors.push({
        name: rest,
        email: '',
        commits: count,
      });
    }
  }

  return contributors;
}

/**
 * Count unique YYYY-MM-DD dates from a list of ISO 8601 date strings.
 */
function countActiveDays(dateLines: string[]): number {
  const uniqueDates = new Set<string>();

  for (const line of dateLines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // ISO 8601 dates start with YYYY-MM-DD
    const dateOnly = trimmed.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
      uniqueDates.add(dateOnly);
    }
  }

  return uniqueDates.size;
}

/**
 * Calculate commits per week and commits per month from the date range and total commits.
 */
function calculateFrequency(
  totalCommits: number,
  firstDate: string | null,
  lastDate: string | null,
): { commitsPerWeek: number; commitsPerMonth: number } {
  if (!firstDate || !lastDate || totalCommits === 0) {
    return { commitsPerWeek: 0, commitsPerMonth: 0 };
  }

  const first = new Date(firstDate);
  const last = new Date(lastDate);

  const diffMs = last.getTime() - first.getTime();
  if (diffMs <= 0) {
    // All commits on the same day
    return { commitsPerWeek: totalCommits, commitsPerMonth: totalCommits };
  }

  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const diffWeeks = Math.max(diffDays / 7, 1);
  const diffMonths = Math.max(diffDays / 30.44, 1); // average month length

  return {
    commitsPerWeek: Math.round((totalCommits / diffWeeks) * 100) / 100,
    commitsPerMonth: Math.round((totalCommits / diffMonths) * 100) / 100,
  };
}

/**
 * Calculate conventional commit percentage from a list of commit subjects.
 */
function calculateConventionalPercent(subjects: string[]): number {
  if (subjects.length === 0) return 0;

  let conventionalCount = 0;
  for (const subject of subjects) {
    if (CONVENTIONAL_COMMIT_RE.test(subject.trim())) {
      conventionalCount++;
    }
  }

  return Math.round((conventionalCount / subjects.length) * 10000) / 100;
}

/**
 * Calculate bus factor: number of contributors who authored >= 5% of commits
 * in the last 12 months. Minimum 1 if there are any contributors.
 */
function calculateBusFactor(contributors: ContributorInfo[]): number {
  if (contributors.length === 0) return 0;

  const totalCommits = contributors.reduce((sum, c) => sum + c.commits, 0);
  if (totalCommits === 0) return 0;

  const threshold = totalCommits * 0.05;
  const significantContributors = contributors.filter(
    (c) => c.commits >= threshold,
  ).length;

  return Math.max(significantContributors, 1);
}

/**
 * Parse recent commits from `git log --format=<hash>|<subject>|<author>|<date>` output.
 */
function parseRecentCommits(stdout: string): RecentCommit[] {
  const commits: RecentCommit[] = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // Format: "hash|message|author|relative-date"
    const parts = trimmed.split('|');
    if (parts.length < 4) continue;

    commits.push({
      hash: parts[0]!.trim(),
      message: parts[1]!.trim(),
      author: parts[2]!.trim(),
      date: parts.slice(3).join('|').trim(), // date may contain | in edge cases
    });
  }

  return commits;
}

/**
 * Calculate average first-line message length and count of very short messages.
 */
function calculateMessageQuality(subjects: string[]): {
  avgLength: number;
  shortCount: number;
} {
  if (subjects.length === 0) return { avgLength: 0, shortCount: 0 };

  let totalLength = 0;
  let shortCount = 0;

  for (const subject of subjects) {
    const len = subject.trim().length;
    totalLength += len;
    if (len < SHORT_MESSAGE_THRESHOLD) {
      shortCount++;
    }
  }

  return {
    avgLength: Math.round(totalLength / subjects.length),
    shortCount,
  };
}

/**
 * Parse `git log --format='>>>%H' --name-only` output into per-commit file lists,
 * and count how many commits touch at least one test file.
 *
 * Each commit block starts with ">>><hash>" followed by changed file paths.
 */
function countCommitsWithTests(stdout: string): {
  count: number;
  total: number;
} {
  // Split on the ">>>" commit marker
  const blocks = stdout.split('>>>');
  let total = 0;
  let withTests = 0;

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    // First line is the commit hash; rest are file paths
    if (lines.length < 2) continue;

    total++;
    // Skip lines[0] (the hash), check remaining file paths
    const filePaths = lines.slice(1);
    const hasTestFile = filePaths.some((line) => TEST_FILE_RE.test(line));
    if (hasTestFile) {
      withTests++;
    }
  }

  return { count: withTests, total };
}

// ---------------------------------------------------------------------------
// Skipped / error result factories
// ---------------------------------------------------------------------------

function skippedResult(reason: string, durationMs: number): GitAnalysisResult {
  return {
    meta: { status: 'skipped', reason, durationMs },
    totalCommits: 0,
    contributors: 0,
    firstCommitDate: null,
    lastCommitDate: null,
    activeDays: 0,
    topContributors: [],
    conventionalCommitPercent: 0,
    busFactor: 0,
    commitFrequency: { commitsPerWeek: 0, commitsPerMonth: 0 },
    recentCommits: [],
    avgMessageLength: 0,
    shortMessageCount: 0,
    commitsWithTests: 0,
    commitsWithTestsPercent: 0,
  };
}

function errorResult(reason: string, durationMs: number): GitAnalysisResult {
  return {
    meta: { status: 'error', reason, durationMs },
    totalCommits: 0,
    contributors: 0,
    firstCommitDate: null,
    lastCommitDate: null,
    activeDays: 0,
    topContributors: [],
    conventionalCommitPercent: 0,
    busFactor: 0,
    commitFrequency: { commitsPerWeek: 0, commitsPerMonth: 0 },
    recentCommits: [],
    avgMessageLength: 0,
    shortMessageCount: 0,
    commitsWithTests: 0,
    commitsWithTestsPercent: 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze git history: commits, contributors, bus factor, conventional commits, frequency.
 *
 * All git commands use execTool (execFile with argv array, no shell interpolation).
 * If the repo is not a git repository, returns a skipped result.
 * Never throws — returns error meta on failure.
 */
export async function analyzeGit(
  index: RepositoryIndex,
): Promise<GitAnalysisResult> {
  const start = performance.now();

  // Check if this is a git repo
  if (!index.gitMeta.isRepo) {
    const elapsed = performance.now() - start;
    return skippedResult('Not a git repository', elapsed);
  }

  const cwd = index.root;
  const timeout = index.config.timeout;

  // Run independent git commands in parallel
  const [
    commitCountResult,
    shortlogResult,
    allDatesResult,
    subjectsResult,
    firstCommitResult,
    lastCommitResult,
    recentShortlogResult,
    recentCommitsResult,
    allSubjectsResult,
    nameOnlyResult,
  ] = await Promise.all([
    // totalCommits
    execTool('git', ['rev-list', '--count', 'HEAD'], { cwd, timeout }),
    // all contributors
    execTool('git', ['shortlog', '-sne', 'HEAD'], { cwd, timeout }),
    // all commit dates for activeDays + frequency
    execTool('git', ['log', '--format=%aI'], { cwd, timeout }),
    // last N commit subjects for conventional commit %
    execTool(
      'git',
      ['log', '--format=%s', `-n`, String(CONVENTIONAL_SAMPLE_SIZE)],
      { cwd, timeout },
    ),
    // first commit date
    execTool('git', ['log', '--format=%aI', '--reverse', '-n', '1'], {
      cwd,
      timeout,
    }),
    // last commit date
    execTool('git', ['log', '--format=%aI', '-n', '1'], { cwd, timeout }),
    // recent contributors (last 12 months) for bus factor
    execTool(
      'git',
      ['shortlog', '-sne', '--since=12 months ago', 'HEAD'],
      { cwd, timeout },
    ),
    // recent commits: hash, subject, author name, relative date
    execTool(
      'git',
      ['log', '--format=%h|%s|%an|%ar', '-n', String(RECENT_COMMITS_LIMIT)],
      { cwd, timeout },
    ),
    // all commit subjects for message quality metrics
    execTool('git', ['log', '--format=%s'], { cwd, timeout }),
    // per-commit file lists for commits-with-tests %
    execTool(
      'git',
      ['log', '--format=>>>%H', '--name-only'],
      { cwd, timeout },
    ),
  ]);

  // Check for critical failures
  if (commitCountResult.exitCode !== 0) {
    const elapsed = performance.now() - start;
    return errorResult(
      `git rev-list failed (exit ${commitCountResult.exitCode}): ${commitCountResult.stderr.slice(0, 200)}`,
      elapsed,
    );
  }

  // Parse totalCommits
  const totalCommits = parseInt(commitCountResult.stdout.trim(), 10) || 0;

  // Parse all contributors
  const allContributors = parseShortlog(shortlogResult.stdout);

  // Top contributors: sorted descending by commits, limited to TOP_CONTRIBUTORS_LIMIT
  const topContributors = allContributors
    .sort((a, b) => b.commits - a.commits)
    .slice(0, TOP_CONTRIBUTORS_LIMIT);

  // Parse dates for active days
  const dateLines = allDatesResult.stdout.split('\n').filter((l) => l.trim());
  const activeDays = countActiveDays(dateLines);

  // Parse commit subjects for conventional commit %
  const subjects = subjectsResult.stdout
    .split('\n')
    .filter((l) => l.trim().length > 0);
  const conventionalCommitPercent = calculateConventionalPercent(subjects);

  // Parse first/last commit dates
  const firstCommitDate = firstCommitResult.exitCode === 0
    ? firstCommitResult.stdout.trim() || null
    : null;
  const lastCommitDate = lastCommitResult.exitCode === 0
    ? lastCommitResult.stdout.trim() || null
    : null;

  // Commit frequency
  const commitFrequency = calculateFrequency(
    totalCommits,
    firstCommitDate,
    lastCommitDate,
  );

  // Bus factor from recent contributors (last 12 months)
  const recentContributors = parseShortlog(recentShortlogResult.stdout);
  const busFactor = calculateBusFactor(recentContributors);

  // Recent commits
  const recentCommits =
    recentCommitsResult.exitCode === 0
      ? parseRecentCommits(recentCommitsResult.stdout)
      : [];

  // Commit message quality from all subjects
  const allSubjects =
    allSubjectsResult.exitCode === 0
      ? allSubjectsResult.stdout
          .split('\n')
          .filter((l) => l.trim().length > 0)
      : subjects; // fallback to the conventional-sample subjects
  const messageQuality = calculateMessageQuality(allSubjects);

  // Commits that include tests
  const testsStats =
    nameOnlyResult.exitCode === 0
      ? countCommitsWithTests(nameOnlyResult.stdout)
      : { count: 0, total: 0 };
  const commitsWithTestsPercent =
    testsStats.total > 0
      ? Math.round((testsStats.count / testsStats.total) * 10000) / 100
      : 0;

  const elapsed = performance.now() - start;

  const meta: AnalyzerMeta = {
    status: 'computed',
    durationMs: elapsed,
  };

  return {
    meta,
    totalCommits,
    contributors: allContributors.length,
    firstCommitDate,
    lastCommitDate,
    activeDays,
    topContributors,
    conventionalCommitPercent,
    busFactor,
    commitFrequency,
    recentCommits,
    avgMessageLength: messageQuality.avgLength,
    shortMessageCount: messageQuality.shortCount,
    commitsWithTests: testsStats.count,
    commitsWithTestsPercent,
  };
}
