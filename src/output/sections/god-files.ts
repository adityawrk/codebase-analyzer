/**
 * God Files section formatter.
 */

import type { ReportData } from '../../core/types.js';

export function formatGodFiles(report: ReportData): string[] {
  if (report.sizing.meta.status !== 'computed' || report.sizing.godFiles.length === 0) {
    return [];
  }

  const lines: string[] = [];
  lines.push('## God Files (>500 Code Lines)');
  lines.push('');
  lines.push('Files exceeding 500 lines of code (blanks and comments excluded).');
  lines.push('');
  lines.push('| File | Code Lines | Language |');
  lines.push('|------|------------|----------|');
  const sorted = [...report.sizing.godFiles].sort((a, b) => b.lines - a.lines);
  for (const f of sorted) {
    lines.push(`| ${f.path} | ${f.lines} | ${f.language} |`);
  }
  lines.push('');

  return lines;
}
