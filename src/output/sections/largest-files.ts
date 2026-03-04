/**
 * Largest Files section formatter.
 */

import type { ReportData } from '../../core/types.js';

export function formatLargestFiles(report: ReportData): string[] {
  if (report.sizing.meta.status !== 'computed' || report.sizing.largestFiles.length === 0) {
    return [];
  }

  const lines: string[] = [];
  lines.push('## Largest Files (Total Lines)');
  lines.push('');
  lines.push('Files with the most total lines (including blanks, comments, and code).');
  lines.push('');
  lines.push('| File | Total Lines |');
  lines.push('|------|-------------|');
  for (const f of report.sizing.largestFiles) {
    lines.push(`| \`${f.path}\` | ${f.lines} |`);
  }
  lines.push('');

  return lines;
}
