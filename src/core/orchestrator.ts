/**
 * Orchestrator — sequences all analysis passes.
 * Builds a RepositoryIndex once, then runs each analyzer against it.
 * Analyzer failures are isolated: one crash doesn't kill the pipeline.
 */

import * as path from 'node:path';
import { buildRepositoryIndex } from './repo-index.js';
import { analyzeSizing } from '../analyzers/sizing.js';
import { analyzeTests } from '../analyzers/testing.js';
import { analyzeStructure } from '../analyzers/structure.js';
import { analyzeRepoHealth } from '../analyzers/repo-health.js';
import { analyzeComplexity } from '../analyzers/complexity.js';
import { analyzeGit } from '../analyzers/git.js';
import { analyzeDependencies } from '../analyzers/dependencies.js';
import { analyzeSecurity } from '../analyzers/security.js';
import { analyzeTechStack } from '../analyzers/tech-stack.js';
import { analyzeEnvVars } from '../analyzers/env-vars.js';
import { analyzeDuplication } from '../analyzers/duplication.js';
import { analyzeArchitecture } from '../analyzers/architecture.js';
import { loadRubric } from '../scoring/rubric.js';
import { computeScoring } from '../scoring/aggregator.js';
import type {
  AnalysisConfig,
  AnalyzerMeta,
  ArchitectureResult,
  ComplexityResult,
  DependencyResult,
  DuplicationResult,
  EnvVarsResult,
  GitAnalysisResult,
  RepoHealthResult,
  ReportData,
  SecurityResult,
  SizingResult,
  StructureResult,
  TechStackResult,
  TestAnalysis,
} from './types.js';

const VERSION = '0.1.0';

function errorMeta(err: unknown, durationMs: number): AnalyzerMeta {
  return {
    status: 'error',
    reason: err instanceof Error ? err.message : String(err),
    durationMs,
  };
}

function emptySizing(): SizingResult {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    totalFiles: 0,
    totalLines: 0,
    totalCodeLines: 0,
    totalBlankLines: 0,
    totalCommentLines: 0,
    languages: [],
    godFiles: [],
  };
}

function emptyStructure(): StructureResult {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    tree: { name: '', fileCount: 0, children: [] },
    treeString: '',
  };
}

function emptyRepoHealth(): RepoHealthResult {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    checks: [],
  };
}

function emptyComplexity(): ComplexityResult {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    repoAvgComplexity: 0,
    repoMaxComplexity: 0,
    totalFunctions: 0,
    fileComplexities: [],
    hotspots: [],
  };
}

function emptyTestAnalysis(): TestAnalysis {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    testFiles: 0,
    testLines: 0,
    codeLines: 0,
    testCodeRatio: 0,
    testFrameworks: [],
    coverageConfigFound: false,
    testFileList: [],
  };
}

function emptyGit(): GitAnalysisResult {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    totalCommits: 0,
    contributors: 0,
    firstCommitDate: null,
    lastCommitDate: null,
    activeDays: 0,
    topContributors: [],
    conventionalCommitPercent: 0,
    busFactor: 0,
    commitFrequency: { commitsPerWeek: 0, commitsPerMonth: 0 },
  };
}

function emptyDependencies(): DependencyResult {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    totalDependencies: 0,
    directDependencies: 0,
    devDependencies: 0,
    ecosystems: [],
    packageManager: null,
    dependencies: [],
  };
}

function emptySecurity(): SecurityResult {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    secretsFound: 0,
    findings: [],
  };
}

function emptyTechStack(): TechStackResult {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    stack: [],
  };
}

function emptyEnvVars(): EnvVarsResult {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    totalVars: 0,
    variables: [],
    byPrefix: {},
  };
}

function emptyDuplication(): DuplicationResult {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    duplicateLines: 0,
    duplicatePercentage: 0,
    totalClones: 0,
    clones: [],
  };
}

function emptyArchitecture(): ArchitectureResult {
  return {
    meta: { status: 'error', reason: 'Analyzer failed', durationMs: 0 },
    totalImports: 0,
    uniqueModules: 0,
    importGraph: [],
    circularDependencies: [],
    moduleCohesion: [],
  };
}

async function runWithTiming<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: () => T,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    console.error(`[orchestrator] ${name} failed:`, err instanceof Error ? err.message : err);
    const result = fallback();
    // Patch meta if present
    if (result && typeof result === 'object' && 'meta' in result) {
      (result as { meta: AnalyzerMeta }).meta = errorMeta(err, durationMs);
    }
    return result;
  }
}

export async function analyzeRepository(
  root: string,
  config: AnalysisConfig,
  rubricPath?: string,
): Promise<ReportData> {
  const absoluteRoot = path.resolve(root);
  const overallStart = performance.now();

  // Phase 1: Build the index (single-pass)
  let index;
  try {
    index = await buildRepositoryIndex(absoluteRoot, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[orchestrator] Failed to build repository index: ${msg}`);
    throw new Error(`Cannot analyze repository — index build failed: ${msg}`);
  }

  // Phase 2: Run analyzers
  // Sizing must run first (testing depends on it)
  const sizing = await runWithTiming('sizing', () => analyzeSizing(index), emptySizing);
  const testAnalysis = await runWithTiming(
    'testAnalysis',
    () => analyzeTests(index, sizing),
    emptyTestAnalysis,
  );

  // These analyzers are independent — run them concurrently
  const [
    structure, repoHealth, complexity, git, dependencies,
    security, techStack, envVars, duplication, architecture,
  ] = await Promise.all([
    runWithTiming('structure', () => analyzeStructure(index), emptyStructure),
    runWithTiming('repoHealth', () => analyzeRepoHealth(index), emptyRepoHealth),
    runWithTiming('complexity', () => analyzeComplexity(index), emptyComplexity),
    runWithTiming('git', () => analyzeGit(index), emptyGit),
    runWithTiming('dependencies', () => analyzeDependencies(index), emptyDependencies),
    runWithTiming('security', () => analyzeSecurity(index), emptySecurity),
    runWithTiming('techStack', () => analyzeTechStack(index), emptyTechStack),
    runWithTiming('envVars', () => analyzeEnvVars(index), emptyEnvVars),
    runWithTiming('duplication', () => analyzeDuplication(index), emptyDuplication),
    runWithTiming('architecture', () => analyzeArchitecture(index), emptyArchitecture),
  ]);

  // Calculate analysis completeness
  const allAnalyzers = [
    sizing, structure, repoHealth, complexity, testAnalysis,
    git, dependencies, security, techStack, envVars,
    duplication, architecture,
  ];
  const computed = allAnalyzers.filter((a) => a.meta.status === 'computed').length;
  const completeness = Math.round((computed / allAnalyzers.length) * 100);

  // Build report object
  const report: ReportData = {
    meta: {
      generatedAt: new Date().toISOString(),
      analyzerVersion: VERSION,
      directory: absoluteRoot,
      analysisCompleteness: completeness,
    },
    sizing,
    structure,
    repoHealth,
    complexity,
    testAnalysis,
    git,
    dependencies,
    security,
    techStack,
    envVars,
    duplication,
    architecture,
  };

  // Phase 3: Compute scoring (skip if rubric failed to load)
  const rubric = loadRubric(rubricPath);
  const hasRubric = Object.keys(rubric.categories).length > 0;
  if (hasRubric) {
    const scoring = computeScoring(report, rubric);
    report.scoring = scoring;
    report.meta.grade = scoring.grade;
    report.meta.score = scoring.normalizedScore;
  }
  report.meta.durationMs = Math.round(performance.now() - overallStart);

  return report;
}
