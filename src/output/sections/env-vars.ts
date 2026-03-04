/**
 * Environment Variables section formatter.
 */

import type { ReportData } from '../../core/types.js';

export function formatEnvVars(report: ReportData): string[] {
  if (report.envVars.meta.status !== 'computed' || report.envVars.totalVars === 0) {
    return [];
  }

  const vars = report.envVars.variables;
  if (vars.length === 0) return [];

  const lines: string[] = [];
  lines.push('## Environment Variables');
  lines.push('');
  lines.push(`**${vars.length} environment variable(s) detected**`);
  lines.push('');

  const prefixes = Object.entries(report.envVars.byPrefix).sort((a, b) => b[1] - a[1]);
  if (prefixes.length > 0) {
    lines.push('### By Prefix');
    lines.push('');
    lines.push('| Prefix | Count |');
    lines.push('|--------|-------|');
    for (const [prefix, count] of prefixes) {
      lines.push(`| ${prefix} | ${count} |`);
    }
    lines.push('');
  }

  // Show variable list (capped at 30)
  const displayed = vars.slice(0, 30);
  lines.push('### Variables');
  lines.push('');
  lines.push('| Name | File | Line |');
  lines.push('|------|------|------|');
  for (const v of displayed) {
    lines.push(`| ${v.name} | ${v.file} | ${v.line} |`);
  }
  if (vars.length > 30) {
    lines.push('');
    lines.push(`*... and ${vars.length - 30} more variables*`);
  }
  lines.push('');

  return lines;
}
