/**
 * Score aggregation engine.
 * Maps analyzer results to rubric metrics, computes per-category and total scores,
 * determines letter grade, and handles partial-data normalization.
 */

import type {
  ReportData,
  FolderNode,
  ScoringResult,
  CategoryScore,
  MetricScore,
  AnalyzerStatus,
} from '../core/types.js';
import type { Rubric, CategoryDefinition, GradeBoundaries } from './rubric.js';
import { scoreMetric } from './rubric.js';

// --- Metric extraction ---

/**
 * Map of category name -> function that extracts metric values from ReportData.
 * Returns null for the whole category if the underlying analyzer was not computed.
 */
interface CategoryExtractor {
  status: (report: ReportData) => AnalyzerStatus;
  metrics: (report: ReportData) => Record<string, unknown>;
}

const CATEGORY_EXTRACTORS: Record<string, CategoryExtractor> = {
  sizing: {
    status: (r) => r.sizing.meta.status,
    metrics: (r) => {
      const totalCommentable = r.sizing.totalCodeLines + r.sizing.totalCommentLines;
      return {
        godFileCount: r.sizing.godFiles.length,
        commentRatio: totalCommentable > 0
          ? r.sizing.totalCommentLines / totalCommentable
          : 0,
      };
    },
  },
  testing: {
    status: (r) => r.testAnalysis.meta.status,
    metrics: (r) => ({
      testCodeRatio: r.testAnalysis.testCodeRatio / 100, // normalize percentage to 0-1
      coverageConfig: r.testAnalysis.coverageConfigFound,
      testFramework: r.testAnalysis.testFrameworks.length,
    }),
  },
  complexity: {
    status: (r) => r.complexity.meta.status,
    metrics: (r) => ({
      avgComplexity: r.complexity.repoAvgComplexity,
      maxComplexity: r.complexity.repoMaxComplexity,
    }),
  },
  repoHealth: {
    status: (r) => r.repoHealth.meta.status,
    metrics: (r) => {
      const result: Record<string, boolean> = {};
      const checkIds = ['readme', 'license', 'ci', 'gitignore', 'editorconfig', 'contributing'];
      for (const id of checkIds) {
        const check = r.repoHealth.checks.find((c) => c.id === id);
        result[id] = check?.present ?? false;
      }
      return result;
    },
  },
  structure: {
    status: (r) => r.structure.meta.status,
    metrics: (r) => ({
      maxDepth: computeMaxDepth(r.structure.tree),
      avgFilesPerFolder: computeAvgFilesPerFolder(r.structure.tree),
    }),
  },
};

// --- Tree helpers ---

/**
 * Recursively computes the maximum directory depth from a FolderNode tree.
 * Root is depth 0.
 */
export function computeMaxDepth(node: FolderNode): number {
  if (node.children.length === 0) {
    return 0;
  }
  let max = 0;
  for (const child of node.children) {
    const childDepth = computeMaxDepth(child);
    if (childDepth + 1 > max) {
      max = childDepth + 1;
    }
  }
  return max;
}

/**
 * Computes the average number of files per directory (folders with at least one file).
 */
export function computeAvgFilesPerFolder(node: FolderNode): number {
  const counts: number[] = [];
  collectFolderFileCounts(node, counts);

  if (counts.length === 0) return 0;

  const sum = counts.reduce((a, b) => a + b, 0);
  return sum / counts.length;
}

function collectFolderFileCounts(node: FolderNode, counts: number[]): void {
  if (node.fileCount > 0) {
    counts.push(node.fileCount);
  }
  for (const child of node.children) {
    collectFolderFileCounts(child, counts);
  }
}

// --- Grade computation ---

function computeGrade(
  normalizedScore: number,
  analysisCompleteness: number,
  boundaries: GradeBoundaries,
): string {
  if (analysisCompleteness < 60) {
    return 'INCOMPLETE';
  }

  // Grade boundaries are sorted highest first
  const gradeKeys = ['A', 'B', 'C', 'D', 'F'] as const;
  const grades: Array<[string, number]> = gradeKeys.map((k) => [k, boundaries[k]]);
  grades.sort(([, a], [, b]) => b - a);
  for (const [grade, minScore] of grades) {
    if (normalizedScore >= minScore) {
      return grade;
    }
  }

  return 'F';
}

// --- Main aggregator ---

/**
 * Computes the full scoring result by mapping analyzer results to rubric metrics.
 * Categories whose analyzer status is not 'computed' are skipped and excluded
 * from totalPossible (normalization).
 */
export function computeScoring(report: ReportData, rubric: Rubric): ScoringResult {
  const categories: Record<string, CategoryScore> = {};
  let totalScore = 0;
  let totalPossible = 0;

  // Count how many analyzers completed (out of 12 total)
  const analyzerKeys: Array<keyof ReportData> = [
    'sizing', 'structure', 'repoHealth', 'complexity',
    'testAnalysis', 'git', 'dependencies', 'security',
    'techStack', 'envVars', 'duplication', 'architecture',
  ];
  const totalAnalyzers = analyzerKeys.length;
  let completedAnalyzers = 0;

  for (const key of analyzerKeys) {
    const result = report[key];
    if (
      result &&
      typeof result === 'object' &&
      'meta' in result &&
      (result as { meta: { status: AnalyzerStatus } }).meta.status === 'computed'
    ) {
      completedAnalyzers++;
    }
  }

  const analysisCompleteness = (completedAnalyzers / totalAnalyzers) * 100;

  for (const [categoryName, categoryDef] of Object.entries(rubric.categories)) {
    const extractor = CATEGORY_EXTRACTORS[categoryName];

    // Skip categories we don't have an extractor for
    if (!extractor) continue;

    const status = extractor.status(report);

    // Skip categories where the analyzer did not complete — don't include in scoring
    if (status !== 'computed') {
      continue;
    }

    const metricValues = extractor.metrics(report);
    const categoryResult = scoreCategory(categoryName, categoryDef, metricValues);

    categories[categoryName] = categoryResult;
    totalScore += categoryResult.score;
    totalPossible += categoryResult.maxScore;
  }

  const normalizedScore = totalPossible > 0
    ? (totalScore / totalPossible) * 100
    : 0;

  const grade = computeGrade(
    normalizedScore,
    analysisCompleteness,
    rubric.gradeBoundaries,
  );

  return {
    totalScore,
    totalPossible,
    normalizedScore: Math.round(normalizedScore * 100) / 100,
    grade,
    categories,
  };
}

function scoreCategory(
  categoryName: string,
  categoryDef: CategoryDefinition,
  metricValues: Record<string, unknown>,
): CategoryScore {
  const metrics: Record<string, MetricScore> = {};
  let categoryScore = 0;
  let categoryMaxScore = 0;

  for (const [metricName, metricDef] of Object.entries(categoryDef.metrics)) {
    const value = metricValues[metricName];
    const result = scoreMetric(
      metricName,
      value,
      metricDef.thresholds,
      metricDef.weight,
    );

    metrics[metricName] = {
      score: result.score,
      maxScore: result.maxScore,
      label: result.label,
      value,
    };

    categoryScore += result.score;
    categoryMaxScore += metricDef.weight;
  }

  return {
    score: categoryScore,
    maxScore: categoryMaxScore,
    metrics,
  };
}
