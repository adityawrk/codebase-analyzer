/**
 * Security section formatter.
 */

import type { ReportData } from '../../core/types.js';

export function formatSecurity(report: ReportData): string[] {
  const lines: string[] = [];

  if (report.security.meta.status === 'computed') {
    lines.push('## Security');
    lines.push('');
    if (report.security.secretsFound === 0) {
      lines.push('No secrets or credentials detected.');
    } else {
      lines.push(`**${report.security.secretsFound} potential secret(s) detected:**`);
      lines.push('');
      lines.push('| File | Line | Rule | Context |');
      lines.push('|------|------|------|---------|');
      for (const f of report.security.findings) {
        lines.push(`| ${f.file} | ${f.line} | ${f.ruleId} | ${f.context ?? 'production'} |`);
      }
    }
    lines.push('');
  } else if (report.security.meta.status === 'skipped') {
    lines.push('## Security');
    lines.push('');
    lines.push(`*Skipped: ${report.security.meta.reason ?? 'Unknown reason'}*`);
    lines.push('');
  }

  return lines;
}
