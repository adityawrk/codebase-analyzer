import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRubric, scoreMetric } from './rubric.js';
import type { Rubric, Threshold, RangeThreshold, ValueThreshold } from './rubric.js';

const RUBRIC_PATH = resolve(import.meta.dirname, '../../rubric.yaml');

describe('loadRubric', () => {
  it('loads the actual rubric.yaml successfully', () => {
    const rubric = loadRubric(RUBRIC_PATH);

    expect(rubric.version).toBe(1);
    expect(rubric.totalWeight).toBe(100);
    expect(Object.keys(rubric.categories).length).toBeGreaterThan(0);
  });

  it('contains expected categories', () => {
    const rubric = loadRubric(RUBRIC_PATH);
    const categoryNames = Object.keys(rubric.categories);

    expect(categoryNames).toContain('sizing');
    expect(categoryNames).toContain('testing');
    expect(categoryNames).toContain('complexity');
    expect(categoryNames).toContain('repoHealth');
    expect(categoryNames).toContain('structure');
  });

  it('has valid weights for all categories', () => {
    const rubric = loadRubric(RUBRIC_PATH);

    for (const [name, category] of Object.entries(rubric.categories)) {
      expect(category.weight).toBeGreaterThan(0);

      // Sum of metric weights should equal category weight
      const metricWeightSum = Object.values(category.metrics).reduce(
        (sum, m) => sum + m.weight,
        0,
      );
      expect(metricWeightSum).toBe(category.weight);
    }
  });

  it('has valid grade boundaries', () => {
    const rubric = loadRubric(RUBRIC_PATH);

    expect(rubric.gradeBoundaries.A).toBe(85);
    expect(rubric.gradeBoundaries.B).toBe(70);
    expect(rubric.gradeBoundaries.C).toBe(55);
    expect(rubric.gradeBoundaries.D).toBe(35);
    expect(rubric.gradeBoundaries.F).toBe(0);
  });

  it('returns default rubric for nonexistent file', () => {
    const rubric = loadRubric('/nonexistent/path/rubric.yaml');

    expect(rubric.version).toBe(1);
    expect(rubric.totalWeight).toBe(100);
    expect(Object.keys(rubric.categories)).toHaveLength(0);
    expect(rubric.gradeBoundaries.A).toBe(90);
  });

  it('each metric has at least one threshold', () => {
    const rubric = loadRubric(RUBRIC_PATH);

    for (const [catName, category] of Object.entries(rubric.categories)) {
      for (const [metricName, metric] of Object.entries(category.metrics)) {
        expect(
          metric.thresholds.length,
          `${catName}.${metricName} should have thresholds`,
        ).toBeGreaterThan(0);
      }
    }
  });
});

describe('scoreMetric — range thresholds (min/max)', () => {
  const rangeThresholds: Threshold[] = [
    { max: 3, score: 10, label: 'Very low complexity' },
    { max: 5, score: 8, label: 'Low complexity' },
    { max: 10, score: 6, label: 'Moderate complexity' },
    { max: 20, score: 3, label: 'High complexity' },
    { min: 20, score: 0, label: 'Very high complexity' },
  ];

  it('scores value in first range', () => {
    const result = scoreMetric('avgComplexity', 2, rangeThresholds, 10);
    expect(result.score).toBe(10);
    expect(result.label).toBe('Very low complexity');
    expect(result.maxScore).toBe(10);
  });

  it('scores value in middle range', () => {
    const result = scoreMetric('avgComplexity', 7, rangeThresholds, 10);
    expect(result.score).toBe(6);
    expect(result.label).toBe('Moderate complexity');
  });

  it('scores value in last range (min only)', () => {
    const result = scoreMetric('avgComplexity', 25, rangeThresholds, 10);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Very high complexity');
  });

  it('scores value exactly on boundary (max: 3, value: 3)', () => {
    const result = scoreMetric('avgComplexity', 3, rangeThresholds, 10);
    expect(result.score).toBe(10);
    expect(result.label).toBe('Very low complexity');
  });

  it('scores value exactly on boundary (max: 5, value: 5)', () => {
    const result = scoreMetric('avgComplexity', 5, rangeThresholds, 10);
    expect(result.score).toBe(8);
    expect(result.label).toBe('Low complexity');
  });

  it('scores value exactly on min boundary (min: 20, value: 20)', () => {
    const result = scoreMetric('avgComplexity', 20, rangeThresholds, 10);
    // max: 20 matches first, so score is 3 ("High complexity")
    expect(result.score).toBe(3);
    expect(result.label).toBe('High complexity');
  });

  it('scores zero correctly', () => {
    const result = scoreMetric('avgComplexity', 0, rangeThresholds, 10);
    expect(result.score).toBe(10);
    expect(result.label).toBe('Very low complexity');
  });
});

describe('scoreMetric — min-only thresholds (descending order)', () => {
  const commentThresholds: Threshold[] = [
    { min: 0.15, score: 5, label: 'Well-commented' },
    { min: 0.10, score: 4, label: 'Good comments' },
    { min: 0.05, score: 3, label: 'Some comments' },
    { min: 0.02, score: 2, label: 'Sparse comments' },
    { max: 0.02, score: 1, label: 'Very few comments' },
  ];

  it('scores high value matching first threshold', () => {
    const result = scoreMetric('commentRatio', 0.20, commentThresholds, 5);
    expect(result.score).toBe(5);
    expect(result.label).toBe('Well-commented');
  });

  it('scores value exactly at min boundary', () => {
    const result = scoreMetric('commentRatio', 0.15, commentThresholds, 5);
    expect(result.score).toBe(5);
    expect(result.label).toBe('Well-commented');
  });

  it('scores mid-range value', () => {
    const result = scoreMetric('commentRatio', 0.08, commentThresholds, 5);
    expect(result.score).toBe(3);
    expect(result.label).toBe('Some comments');
  });

  it('scores low value with max threshold', () => {
    const result = scoreMetric('commentRatio', 0.01, commentThresholds, 5);
    expect(result.score).toBe(1);
    expect(result.label).toBe('Very few comments');
  });
});

describe('scoreMetric — exact value thresholds (boolean)', () => {
  const booleanThresholds: Threshold[] = [
    { value: true, score: 5, label: 'Coverage configured' },
    { value: false, score: 0, label: 'No coverage config' },
  ];

  it('scores true value', () => {
    const result = scoreMetric('coverageConfig', true, booleanThresholds, 5);
    expect(result.score).toBe(5);
    expect(result.label).toBe('Coverage configured');
  });

  it('scores false value', () => {
    const result = scoreMetric('coverageConfig', false, booleanThresholds, 5);
    expect(result.score).toBe(0);
    expect(result.label).toBe('No coverage config');
  });
});

describe('scoreMetric — exact value thresholds (numeric)', () => {
  const numericValueThresholds: Threshold[] = [
    { min: 2, score: 5, label: 'Multiple frameworks detected' },
    { min: 1, score: 4, label: 'Framework detected' },
    { value: 0, score: 0, label: 'No test framework' },
  ];

  it('scores exact numeric match of 0', () => {
    const result = scoreMetric('testFramework', 0, numericValueThresholds, 5);
    expect(result.score).toBe(0);
    expect(result.label).toBe('No test framework');
  });

  it('scores range match of 1', () => {
    const result = scoreMetric('testFramework', 1, numericValueThresholds, 5);
    expect(result.score).toBe(4);
    expect(result.label).toBe('Framework detected');
  });

  it('scores range match of 3', () => {
    const result = scoreMetric('testFramework', 3, numericValueThresholds, 5);
    expect(result.score).toBe(5);
    expect(result.label).toBe('Multiple frameworks detected');
  });
});

describe('scoreMetric — edge cases', () => {
  it('returns zero score with label when no threshold matches', () => {
    const thresholds: Threshold[] = [
      { min: 10, score: 5, label: 'High' },
    ];
    const result = scoreMetric('test', 5, thresholds, 5);
    expect(result.score).toBe(0);
    expect(result.label).toBe('No matching threshold');
  });

  it('handles empty thresholds array', () => {
    const result = scoreMetric('test', 5, [], 10);
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(10);
    expect(result.label).toBe('No matching threshold');
  });

  it('handles NaN value for range thresholds', () => {
    const thresholds: Threshold[] = [
      { max: 10, score: 5, label: 'Low' },
    ];
    const result = scoreMetric('test', 'not-a-number', thresholds, 5);
    expect(result.score).toBe(0);
    expect(result.label).toBe('No matching threshold');
  });

  it('handles negative values', () => {
    const thresholds: Threshold[] = [
      { max: 0, score: 10, label: 'Negative or zero' },
      { max: 5, score: 5, label: 'Low' },
    ];
    const result = scoreMetric('test', -3, thresholds, 10);
    expect(result.score).toBe(10);
    expect(result.label).toBe('Negative or zero');
  });
});

// --- New tests: Invalid YAML resilience ---

describe('loadRubric — invalid YAML resilience', () => {
  function writeTempYaml(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'rubric-test-'));
    const filePath = join(dir, 'rubric.yaml');
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  it('returns default rubric for malformed YAML', () => {
    const filePath = writeTempYaml('{{{{not valid yaml at all::::');
    try {
      const rubric = loadRubric(filePath);
      expect(rubric.version).toBe(1);
      expect(rubric.totalWeight).toBe(100);
      expect(Object.keys(rubric.categories)).toHaveLength(0);
      expect(rubric.gradeBoundaries.A).toBe(90);
    } finally {
      unlinkSync(filePath);
    }
  });

  it('returns default rubric for empty file', () => {
    const filePath = writeTempYaml('');
    try {
      const rubric = loadRubric(filePath);
      expect(rubric.version).toBe(1);
      expect(rubric.totalWeight).toBe(100);
      expect(Object.keys(rubric.categories)).toHaveLength(0);
      expect(rubric.gradeBoundaries.A).toBe(90);
    } finally {
      unlinkSync(filePath);
    }
  });

  it('returns default rubric for YAML with wrong types (categories as array)', () => {
    const yamlContent = `
version: 1
totalWeight: 100
categories:
  - sizing
  - testing
gradeBoundaries:
  A: 90
  B: 75
  C: 60
  D: 40
  F: 0
`;
    const filePath = writeTempYaml(yamlContent);
    try {
      const rubric = loadRubric(filePath);
      // categories as array should be rejected by validateCategories
      expect(Object.keys(rubric.categories)).toHaveLength(0);
      // But the rest of the rubric should still be parsed
      expect(rubric.version).toBe(1);
      expect(rubric.totalWeight).toBe(100);
      expect(rubric.gradeBoundaries.A).toBe(90);
    } finally {
      unlinkSync(filePath);
    }
  });
});

// --- New tests: scoreMetric with null/undefined ---

describe('scoreMetric — null and undefined values', () => {
  it('returns no match for undefined value against range thresholds', () => {
    const thresholds: Threshold[] = [
      { max: 10, score: 5, label: 'Low' },
      { min: 10, score: 0, label: 'High' },
    ];
    const result = scoreMetric('test', undefined, thresholds, 5);
    expect(result.score).toBe(0);
    expect(result.label).toBe('No matching threshold');
  });

  it('returns no match for null value against boolean thresholds', () => {
    const thresholds: Threshold[] = [
      { value: true, score: 5, label: 'Yes' },
      { value: false, score: 0, label: 'No' },
    ];
    const result = scoreMetric('test', null, thresholds, 5);
    expect(result.score).toBe(0);
    expect(result.label).toBe('No matching threshold');
  });
});

// --- New tests: scoreMetric with Infinity ---

describe('scoreMetric — Infinity values', () => {
  const rangeThresholds: Threshold[] = [
    { max: 10, score: 5, label: 'Low' },
    { min: 10, score: 0, label: 'High' },
  ];

  it('returns no match for Infinity against range thresholds', () => {
    const result = scoreMetric('test', Infinity, rangeThresholds, 5);
    expect(result.score).toBe(0);
    expect(result.label).toBe('No matching threshold');
  });

  it('returns no match for -Infinity against range thresholds', () => {
    const result = scoreMetric('test', -Infinity, rangeThresholds, 5);
    expect(result.score).toBe(0);
    expect(result.label).toBe('No matching threshold');
  });
});

// --- New tests: scoreMetric with both min and max ---

describe('scoreMetric — min+max range thresholds', () => {
  const bandedThresholds: Threshold[] = [
    { min: 0, max: 5, score: 10, label: 'Excellent' },
    { min: 6, max: 10, score: 7, label: 'Good' },
    { min: 11, max: 20, score: 3, label: 'Moderate' },
    { min: 21, score: 0, label: 'Poor' },
  ];

  it('matches value in min+max range', () => {
    const result = scoreMetric('metric', 3, bandedThresholds, 10);
    expect(result.score).toBe(10);
    expect(result.label).toBe('Excellent');

    const result2 = scoreMetric('metric', 8, bandedThresholds, 10);
    expect(result2.score).toBe(7);
    expect(result2.label).toBe('Good');

    const result3 = scoreMetric('metric', 15, bandedThresholds, 10);
    expect(result3.score).toBe(3);
    expect(result3.label).toBe('Moderate');
  });

  it('rejects value outside min+max range', () => {
    // Value 5.5 is above the first band (max: 5) but below the second band (min: 6)
    const gapThresholds: Threshold[] = [
      { min: 0, max: 5, score: 10, label: 'Low' },
      { min: 6, max: 10, score: 5, label: 'Mid' },
    ];
    const result = scoreMetric('metric', 5.5, gapThresholds, 10);
    expect(result.score).toBe(0);
    expect(result.label).toBe('No matching threshold');
  });
});

// --- New tests: Prototype pollution protection ---

describe('loadRubric — prototype pollution protection', () => {
  it('filters __proto__ keys from rubric categories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rubric-proto-'));
    const filePath = join(dir, 'rubric.yaml');
    const yamlContent = `
version: 1
totalWeight: 100
categories:
  __proto__:
    weight: 50
    metrics:
      evilMetric:
        weight: 50
        description: "should be filtered"
        thresholds:
          - { max: 10, score: 50, label: "evil" }
  sizing:
    weight: 10
    metrics:
      godFileCount:
        weight: 10
        description: "safe metric"
        thresholds:
          - { max: 0, score: 10, label: "No god files" }
gradeBoundaries:
  A: 90
  B: 75
  C: 60
  D: 40
  F: 0
`;
    writeFileSync(filePath, yamlContent, 'utf-8');
    try {
      const rubric = loadRubric(filePath);
      // __proto__ should be filtered out
      expect(Object.hasOwn(rubric.categories, '__proto__')).toBe(false);
      // Normal category should still be present
      expect(rubric.categories['sizing']).toBeDefined();
      expect(rubric.categories['sizing']!.metrics['godFileCount']).toBeDefined();
    } finally {
      unlinkSync(filePath);
    }
  });

  it('filters constructor and prototype keys from categories and metrics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rubric-proto2-'));
    const filePath = join(dir, 'rubric.yaml');
    const yamlContent = `
version: 1
totalWeight: 100
categories:
  constructor:
    weight: 30
    metrics:
      evilMetric:
        weight: 30
        description: "should be filtered"
        thresholds:
          - { max: 10, score: 30, label: "evil" }
  prototype:
    weight: 30
    metrics:
      evilMetric:
        weight: 30
        description: "should be filtered"
        thresholds:
          - { max: 10, score: 30, label: "evil" }
  sizing:
    weight: 10
    metrics:
      __proto__:
        weight: 5
        description: "metric-level proto"
        thresholds:
          - { max: 10, score: 5, label: "evil" }
      godFileCount:
        weight: 10
        description: "safe"
        thresholds:
          - { max: 0, score: 10, label: "No god files" }
gradeBoundaries:
  A: 90
  B: 75
  C: 60
  D: 40
  F: 0
`;
    writeFileSync(filePath, yamlContent, 'utf-8');
    try {
      const rubric = loadRubric(filePath);
      expect(Object.hasOwn(rubric.categories, 'constructor')).toBe(false);
      expect(Object.hasOwn(rubric.categories, 'prototype')).toBe(false);
      // Metric-level __proto__ should also be filtered
      expect(rubric.categories['sizing']).toBeDefined();
      expect(Object.hasOwn(rubric.categories['sizing']!.metrics, '__proto__')).toBe(false);
      expect(rubric.categories['sizing']!.metrics['godFileCount']).toBeDefined();
    } finally {
      unlinkSync(filePath);
    }
  });

  it('filters malformed threshold entries from thresholds array', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rubric-thresh-'));
    const filePath = join(dir, 'rubric.yaml');
    const yamlContent = `
version: 1
totalWeight: 10
categories:
  sizing:
    weight: 10
    metrics:
      godFileCount:
        weight: 10
        description: "test"
        thresholds:
          - "not an object"
          - 42
          - { max: 3, score: .nan, label: "nan score" }
          - { max: 3, score: .inf, label: "inf score" }
          - { garbage: true }
          - { max: 0, score: 10, label: "Good" }
gradeBoundaries:
  A: 90
  B: 75
  C: 60
  D: 40
  F: 0
`;
    writeFileSync(filePath, yamlContent, 'utf-8');
    try {
      const rubric = loadRubric(filePath);
      const thresholds = rubric.categories['sizing']!.metrics['godFileCount']!.thresholds;
      // Only the last valid threshold should survive
      expect(thresholds.length).toBe(1);
      expect((thresholds[0] as any).score).toBe(10);
    } finally {
      unlinkSync(filePath);
    }
  });
});
