/**
 * Cyclomatic Complexity section formatter.
 */

import type { ReportData } from '../../core/types.js';

export function formatComplexity(report: ReportData): string[] {
  if (report.complexity.meta.status === 'skipped') {
    return [
      '## Cyclomatic Complexity',
      '',
      `*Skipped: ${report.complexity.meta.reason ?? 'Unknown reason'}*`,
      '',
    ];
  }
  if (report.complexity.meta.status !== 'computed') return [];

  const lines: string[] = [];
  lines.push('## Cyclomatic Complexity');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Average Complexity | ${report.complexity.repoAvgComplexity.toFixed(1)} |`);
  lines.push(`| Max Complexity | ${report.complexity.repoMaxComplexity} |`);
  lines.push(`| Total Functions | ${report.complexity.totalFunctions} |`);
  lines.push('');

  if (report.complexity.hotspots.length > 0) {
    lines.push('### Complexity Hotspots');
    lines.push('');
    lines.push('| Function | File | Line | Complexity |');
    lines.push('|----------|------|------|------------|');
    for (const fn of report.complexity.hotspots) {
      lines.push(`| ${fn.name} | ${fn.file} | ${fn.line} | ${fn.complexity} |`);
    }
    lines.push('');
  }

  return lines;
}
