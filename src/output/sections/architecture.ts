/**
 * Architecture section formatter.
 */

import type { ReportData } from '../../core/types.js';

export function formatArchitecture(report: ReportData): string[] {
  if (report.architecture.meta.status === 'skipped') {
    return [
      '## Architecture',
      '',
      `*Skipped: ${report.architecture.meta.reason ?? 'Unknown reason'}*`,
      '',
    ];
  }
  if (report.architecture.meta.status !== 'computed') return [];

  const lines: string[] = [];
  lines.push('## Architecture');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Imports | ${report.architecture.totalImports} |`);
  lines.push(`| Unique Modules | ${report.architecture.uniqueModules} |`);
  lines.push(`| Circular Dependencies | ${report.architecture.circularDependencies.length} |`);
  lines.push('');

  if (report.architecture.circularDependencies.length > 0) {
    lines.push('### Circular Dependencies');
    lines.push('');
    for (const cd of report.architecture.circularDependencies) {
      lines.push(`- ${cd.cycle.join(' → ')} → ${cd.cycle[0]}`);
    }
    lines.push('');
  }

  if (report.architecture.moduleCohesion.length > 0) {
    lines.push('### Module Cohesion');
    lines.push('');
    lines.push('| Module | Intra-module | Total | Cohesion Ratio |');
    lines.push('|--------|-------------|-------|----------------|');
    const sorted = [...report.architecture.moduleCohesion].sort((a, b) => b.cohesionRatio - a.cohesionRatio);
    for (const m of sorted) {
      lines.push(`| ${m.module} | ${m.intraImports} | ${m.totalImports} | ${m.cohesionRatio.toFixed(2)} |`);
    }
    lines.push('');
  }

  return lines;
}
