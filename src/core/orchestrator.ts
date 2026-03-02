/**
 * Orchestrator — sequences all analysis passes.
 * Builds a RepositoryIndex once, then runs each analyzer against it.
 * Analyzer failures are isolated: one crash doesn't kill the pipeline.
 */

import * as path from 'node:path';
import { buildRepositoryIndex } from './repo-index.js';
import { analyzeSizing, analyzeTests } from '../analyzers/sizing.js';
import { analyzeStructure } from '../analyzers/structure.js';
import { analyzeRepoHealth } from '../analyzers/repo-health.js';
import { analyzeComplexity } from '../analyzers/complexity.js';
import type {
  AnalysisConfig,
  AnalyzerMeta,
  ComplexityResult,
  RepoHealthResult,
  ReportData,
  SizingResult,
  StructureResult,
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
    testFiles: 0,
    testLines: 0,
    codeLines: 0,
    testCodeRatio: 0,
    testFrameworks: [],
    coverageConfigFound: false,
    testFileList: [],
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
): Promise<ReportData> {
  const absoluteRoot = path.resolve(root);
  const overallStart = performance.now();

  // Phase 1: Build the index (single-pass)
  const index = await buildRepositoryIndex(absoluteRoot, config);

  // Phase 2: Run analyzers (sequential for now, parallel later as optimization)
  const sizing = await runWithTiming('sizing', () => analyzeSizing(index), emptySizing);
  const testAnalysis = await runWithTiming(
    'testAnalysis',
    () => Promise.resolve(analyzeTests(index, sizing)),
    emptyTestAnalysis,
  );
  const structure = await runWithTiming('structure', () => analyzeStructure(index), emptyStructure);
  const repoHealth = await runWithTiming(
    'repoHealth',
    () => analyzeRepoHealth(index),
    emptyRepoHealth,
  );
  const complexity = await runWithTiming(
    'complexity',
    () => analyzeComplexity(index),
    emptyComplexity,
  );

  // Calculate analysis completeness
  const analyzers = [sizing, structure, repoHealth, complexity];
  const computed = analyzers.filter((a) => a.meta.status === 'computed').length;
  const completeness = Math.round((computed / analyzers.length) * 100);

  const overallDurationMs = Math.round(performance.now() - overallStart);

  return {
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
  };
}
