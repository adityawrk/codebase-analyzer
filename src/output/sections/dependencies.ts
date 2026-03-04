/**
 * Dependencies section formatter.
 */

import type { ReportData } from '../../core/types.js';

export function formatDependencies(report: ReportData): string[] {
  if (report.dependencies.meta.status !== 'computed') return [];

  const lines: string[] = [];
  lines.push('## Dependencies');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Dependencies | ${report.dependencies.totalDependencies} |`);
  lines.push(`| Direct Dependencies | ${report.dependencies.directDependencies} |`);
  lines.push(`| Dev Dependencies | ${report.dependencies.devDependencies} |`);
  if (report.dependencies.packageManager) {
    lines.push(`| Package Manager | ${report.dependencies.packageManager} |`);
  }
  lines.push(`| Ecosystems | ${report.dependencies.ecosystems.join(', ') || 'None detected'} |`);
  lines.push('');

  if (report.dependencies.dependencies.length > 0) {
    lines.push('### Dependency List');
    lines.push('');
    lines.push('| Name | Version | Type | Ecosystem |');
    lines.push('|------|---------|------|-----------|');
    const deps = report.dependencies.dependencies.slice(0, 50);
    for (const d of deps) {
      lines.push(`| ${d.name} | ${d.version} | ${d.type} | ${d.ecosystem} |`);
    }
    if (report.dependencies.dependencies.length > 50) {
      lines.push('');
      lines.push(`*... and ${report.dependencies.dependencies.length - 50} more dependencies*`);
    }
    lines.push('');
  }

  return lines;
}
