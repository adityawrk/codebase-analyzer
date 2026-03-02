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

const DEFAULT_GRADE_BOUNDARIES: GradeBoundaries = { A: 90, B: 75, C: 60, D: 40, F: 0 };

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function emptyRubric(): Rubric {
  return {
    version: 1,
    totalWeight: 100,
    categories: {},
    gradeBoundaries: { ...DEFAULT_GRADE_BOUNDARIES },
  };
}

/**
 * Validates that parsed categories have the expected structure:
 * each category must have numeric weight and a metrics object where
 * each metric has numeric weight and a thresholds array.
 * Filters prototype-pollution keys.
 */
function validateCategories(
  raw: unknown,
): Record<string, CategoryDefinition> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const result: Record<string, CategoryDefinition> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (!val || typeof val !== 'object' || Array.isArray(val)) continue;

    const cat = val as Record<string, unknown>;
    const rawWeight = cat['weight'];
    const weight = typeof rawWeight === 'number' && Number.isFinite(rawWeight) && rawWeight >= 0
      ? rawWeight
      : 0;
    const rawMetrics = cat['metrics'];
    if (!rawMetrics || typeof rawMetrics !== 'object' || Array.isArray(rawMetrics)) continue;

    const metrics: Record<string, MetricDefinition> = {};
    let valid = true;
    for (const [mKey, mVal] of Object.entries(rawMetrics as Record<string, unknown>)) {
      if (RESERVED_KEYS.has(mKey)) continue;
      if (!mVal || typeof mVal !== 'object' || Array.isArray(mVal)) {
        valid = false;
        break;
      }
      const m = mVal as Record<string, unknown>;
      const mWeight = m['weight'];
      if (typeof mWeight !== 'number' || !Number.isFinite(mWeight) || mWeight < 0) {
        valid = false; break;
      }
      if (!Array.isArray(m['thresholds'])) { valid = false; break; }

      // Validate individual threshold entries — filter out malformed ones
      const validThresholds: Threshold[] = [];
      for (const t of m['thresholds'] as unknown[]) {
        if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
        const tObj = t as Record<string, unknown>;
        if (typeof tObj['score'] !== 'number' || !Number.isFinite(tObj['score'])) continue;
        // Must be a value threshold or range threshold
        const hasValue = 'value' in tObj;
        const hasMin = 'min' in tObj && (typeof tObj['min'] === 'number');
        const hasMax = 'max' in tObj && (typeof tObj['max'] === 'number');
        if (!hasValue && !hasMin && !hasMax) continue;
        validThresholds.push(t as Threshold);
      }

      metrics[mKey] = {
        weight: mWeight,
        description: typeof m['description'] === 'string' ? m['description'] as string : '',
        thresholds: validThresholds,
      };
    }
    if (!valid) continue;

    result[key] = { weight, metrics };
  }
  return result;
}

function validateGradeBoundaries(raw: unknown): GradeBoundaries {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_GRADE_BOUNDARIES };
  const obj = raw as Record<string, unknown>;
  return {
    A: typeof obj['A'] === 'number' ? obj['A'] : 90,
    B: typeof obj['B'] === 'number' ? obj['B'] : 75,
    C: typeof obj['C'] === 'number' ? obj['C'] : 60,
    D: typeof obj['D'] === 'number' ? obj['D'] : 40,
    F: typeof obj['F'] === 'number' ? obj['F'] : 0,
  };
}

/**
 * Loads and parses the rubric YAML file.
 * Validates structure at load time — malformed categories are skipped.
 * Falls back to an empty default rubric if the file cannot be read or parsed.
 */
export function loadRubric(rubricPath?: string): Rubric {
  const filePath = rubricPath ?? DEFAULT_RUBRIC_PATH;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = yaml.parse(raw);

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`[rubric] Invalid rubric format at ${filePath} — expected YAML mapping`);
      return emptyRubric();
    }

    const categories = validateCategories(parsed['categories']);
    const gradeBoundaries = validateGradeBoundaries(parsed['gradeBoundaries']);

    // Warn on weight mismatches (non-fatal)
    let computedTotal = 0;
    for (const [catName, cat] of Object.entries(categories)) {
      const metricSum = Object.values(cat.metrics).reduce((s, m) => s + m.weight, 0);
      if (metricSum !== cat.weight) {
        console.warn(`[rubric] Category "${catName}" weight (${cat.weight}) != metric sum (${metricSum})`);
      }
      computedTotal += cat.weight;
    }

    const totalWeight = typeof parsed['totalWeight'] === 'number' ? parsed['totalWeight'] : 100;
    if (Object.keys(categories).length > 0 && computedTotal !== totalWeight) {
      console.warn(`[rubric] totalWeight (${totalWeight}) != category sum (${computedTotal})`);
    }

    return {
      version: typeof parsed['version'] === 'number' ? parsed['version'] : 1,
      totalWeight,
      categories,
      gradeBoundaries,
    };
  } catch (err) {
    console.warn(
      `[rubric] Failed to load rubric from ${filePath}:`,
      err instanceof Error ? err.message : err,
    );
    return emptyRubric();
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
      if (!Number.isFinite(numValue)) continue;

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
