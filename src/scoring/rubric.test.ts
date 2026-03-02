import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
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

    expect(rubric.gradeBoundaries.A).toBe(90);
    expect(rubric.gradeBoundaries.B).toBe(75);
    expect(rubric.gradeBoundaries.C).toBe(60);
    expect(rubric.gradeBoundaries.D).toBe(40);
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
