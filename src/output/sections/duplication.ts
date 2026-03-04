/**
 * Code Duplication section formatter.
 */

import type { ReportData } from '../../core/types.js';

export function formatDuplication(report: ReportData): string[] {
  const lines: string[] = [];

  if (report.duplication.meta.status === 'computed') {
    lines.push('## Code Duplication');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Duplicate Lines | ${report.duplication.duplicateLines} |`);
    lines.push(`| Duplication % | ${report.duplication.duplicatePercentage.toFixed(1)}% |`);
    lines.push(`| Clone Pairs | ${report.duplication.totalClones} |`);
    lines.push('');

    if (report.duplication.clones.length > 0) {
      lines.push('### Largest Clones');
      lines.push('');
      lines.push('| First File | Lines | Second File | Lines |');
      lines.push('|------------|-------|-------------|-------|');
      const topClones = report.duplication.clones.slice(0, 10);
      for (const c of topClones) {
        // Display actual range span for each file — avoids showing impossible
        // line counts when jscpd's fragment size doesn't match the range.
        const firstSpan = Math.max(c.firstEndLine - c.firstStartLine + 1, 1);
        const secondSpan = Math.max(c.secondEndLine - c.secondStartLine + 1, 1);
        lines.push(`| ${c.firstFile}:${c.firstStartLine}-${c.firstEndLine} | ${firstSpan} | ${c.secondFile}:${c.secondStartLine}-${c.secondEndLine} | ${secondSpan} |`);
      }
      lines.push('');
    }
  } else if (report.duplication.meta.status === 'skipped') {
    lines.push('## Code Duplication');
    lines.push('');
    lines.push(`*Skipped: ${report.duplication.meta.reason ?? 'Unknown reason'}*`);
    lines.push('');
  }

  return lines;
}
