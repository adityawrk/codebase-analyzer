/**
 * Repository Health section formatter.
 */

import type { ReportData } from '../../core/types.js';

export function formatHealth(report: ReportData): string[] {
  if (report.repoHealth.meta.status !== 'computed') return [];

  const lines: string[] = [];
  lines.push('## Repository Health');
  lines.push('');
  lines.push('| Check | Status | Path |');
  lines.push('|-------|--------|------|');
  for (const check of report.repoHealth.checks) {
    const status = check.present ? 'Present' : 'Missing';
    const icon = check.present ? '\u2705' : '\u274C';
    const filePath = check.path ?? '';
    lines.push(`| ${check.name} | ${icon} ${status} | ${filePath} |`);
  }
  lines.push('');

  return lines;
}
