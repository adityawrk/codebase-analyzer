/**
 * Summary section formatter.
 */

import type { ReportData } from '../../core/types.js';
import { NON_CODE_LANGUAGES } from './helpers.js';

export function formatSummary(report: ReportData): string[] {
  const lines: string[] = [];
  lines.push('## Summary');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total Files (tracked) | ${report.sizing.totalFiles} |`);

  // Total Lines of Code
  if (report.sizing.meta.status === 'computed') {
    // Use code-only total: sum lines from non-filtered languages only
    const codeOnlyTotal = report.sizing.languages
      .filter((l) => !NON_CODE_LANGUAGES.has(l.language.toLowerCase()))
      .reduce((sum, l) => sum + l.lines, 0);
    lines.push(`| Total Lines of Code | ${codeOnlyTotal} |`);
  }

  // Languages detected (count) — exclude non-code languages
  if (report.sizing.meta.status === 'computed' && report.sizing.languages.length > 0) {
    const codeLanguageCount = report.sizing.languages.filter(
      (l) => !NON_CODE_LANGUAGES.has(l.language.toLowerCase()),
    ).length;
    if (codeLanguageCount > 0) {
      lines.push(`| Languages Detected | ${codeLanguageCount} |`);
    }
  }

  // Test Coverage Ratio
  if (report.testAnalysis.meta.status === 'computed') {
    lines.push(`| Test/Code Ratio | ${report.testAnalysis.testCodeRatio}% |`);
  }

  // Complexity Average
  if (report.complexity.meta.status === 'computed') {
    lines.push(`| Complexity Average | ${report.complexity.repoAvgComplexity.toFixed(1)} |`);
  }

  lines.push('');

  // Analysis completeness note — always show
  lines.push(`**Analysis Completeness:** ${report.meta.analysisCompleteness}%`);
  lines.push('');

  return lines;
}
