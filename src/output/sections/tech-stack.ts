/**
 * Tech Stack section formatter.
 */

import type { ReportData } from '../../core/types.js';

export function formatTechStack(report: ReportData): string[] {
  if (report.techStack.meta.status !== 'computed' || report.techStack.stack.length === 0) {
    return [];
  }

  const lines: string[] = [];
  lines.push('## Tech Stack');
  lines.push('');
  lines.push('| Tool | Category | Source |');
  lines.push('|------|----------|--------|');
  const sortedStack = [...report.techStack.stack].sort((a, b) => a.category.localeCompare(b.category));
  for (const entry of sortedStack) {
    lines.push(`| ${entry.name} | ${entry.category} | ${entry.source} |`);
  }
  lines.push('');

  return lines;
}
