/**
 * Rubric loader and metric scorer.
 * Reads rubric.yaml and evaluates metric values against threshold-based scoring rules.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'yaml';

// --- Rubric type definitions ---

export interface RangeThreshold {
  min?: number;
  max?: number;
  score: number;
  label?: string;
}

export interface ValueThreshold {
  value: boolean | number;
  score: number;
  label?: string;
}

export type Threshold = RangeThreshold | ValueThreshold;

export interface MetricDefinition {
  weight: number;
  description: string;
  thresholds: Threshold[];
}

export interface CategoryDefinition {
  weight: number;
  metrics: Record<string, MetricDefinition>;
}

export interface GradeBoundaries {
  A: number;
  B: number;
  C: number;
  D: number;
  F: number;
}

export interface Rubric {
  version: number;
  totalWeight: number;
  categories: Record<string, CategoryDefinition>;
  gradeBoundaries: GradeBoundaries;
}

// --- Type guards ---

function isValueThreshold(t: Threshold): t is ValueThreshold {
  return 'value' in t;
}

function isRangeThreshold(t: Threshold): t is RangeThreshold {
  return 'min' in t || 'max' in t;
}

// --- Rubric loader ---

const DEFAULT_RUBRIC_PATH = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '../../rubric.yaml',
);

/**
 * Loads and parses the rubric YAML file.
 * Falls back to an empty default rubric if the file cannot be read or parsed.
 */
export function loadRubric(rubricPath?: string): Rubric {
  const filePath = rubricPath ?? DEFAULT_RUBRIC_PATH;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = yaml.parse(raw) as Record<string, unknown>;

    return {
      version: (parsed['version'] as number) ?? 1,
      totalWeight: (parsed['totalWeight'] as number) ?? 100,
      categories: (parsed['categories'] as Record<string, CategoryDefinition>) ?? {},
      gradeBoundaries: (parsed['gradeBoundaries'] as GradeBoundaries) ?? {
        A: 90,
        B: 75,
        C: 60,
        D: 40,
        F: 0,
      },
    };
  } catch {
    return {
      version: 1,
      totalWeight: 100,
      categories: {},
      gradeBoundaries: { A: 90, B: 75, C: 60, D: 40, F: 0 },
    };
  }
}

// --- Metric scorer ---

export interface MetricScoreResult {
  score: number;
  maxScore: number;
  label: string;
}

/**
 * Evaluates a metric value against a list of thresholds.
 * For range thresholds (min/max), iterates from first to last — first match wins.
 * For value thresholds, performs exact equality comparison.
 *
 * Returns { score: 0, maxScore, label: "No matching threshold" } if nothing matches.
 */
export function scoreMetric(
  metricName: string,
  value: unknown,
  thresholds: Threshold[],
  maxScore: number,
): MetricScoreResult {
  for (const threshold of thresholds) {
    if (isValueThreshold(threshold)) {
      if (value === threshold.value) {
        return {
          score: threshold.score,
          maxScore,
          label: threshold.label ?? metricName,
        };
      }
      continue;
    }

    if (isRangeThreshold(threshold)) {
      const numValue = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(numValue)) continue;

      const hasMin = threshold.min !== undefined;
      const hasMax = threshold.max !== undefined;

      // Both min and max specified: min <= value <= max
      if (hasMin && hasMax) {
        if (numValue >= threshold.min! && numValue <= threshold.max!) {
          return {
            score: threshold.score,
            maxScore,
            label: threshold.label ?? metricName,
          };
        }
        continue;
      }

      // Only max specified: value <= max
      if (hasMax && !hasMin) {
        if (numValue <= threshold.max!) {
          return {
            score: threshold.score,
            maxScore,
            label: threshold.label ?? metricName,
          };
        }
        continue;
      }

      // Only min specified: value >= min
      if (hasMin && !hasMax) {
        if (numValue >= threshold.min!) {
          return {
            score: threshold.score,
            maxScore,
            label: threshold.label ?? metricName,
          };
        }
        continue;
      }
    }
  }

  return {
    score: 0,
    maxScore,
    label: 'No matching threshold',
  };
}
