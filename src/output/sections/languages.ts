/**
 * Language Breakdown section formatter.
 */

import type { ReportData } from '../../core/types.js';
import { NON_CODE_LANGUAGES } from './helpers.js';

export function formatLanguages(report: ReportData): string[] {
  if (report.sizing.meta.status !== 'computed' || report.sizing.languages.length === 0) {
    return [];
  }

  // Filter out non-code languages (License, Plain Text, Markdown, JSON, etc.)
  const codeLanguages = report.sizing.languages.filter(
    (l) => !NON_CODE_LANGUAGES.has(l.language.toLowerCase()),
  );
  if (codeLanguages.length === 0) return [];

  // Recalculate percentages based on code-only total
  const codeTotalLines = codeLanguages.reduce((sum, l) => sum + l.codeLines, 0);

  const lines: string[] = [];
  lines.push('## Language Breakdown');
  lines.push('| Extension | Files | Lines | % of Code |');
  lines.push('|-----------|-------|-------|-----------|');
  const sorted = [...codeLanguages].sort((a, b) => b.lines - a.lines);
  for (const lang of sorted) {
    const pct = codeTotalLines > 0 ? Math.round((lang.codeLines / codeTotalLines) * 100) : 0;
    const label = lang.extension || lang.language;
    lines.push(
      `| ${label.padEnd(10)} | ${String(lang.files).padStart(5)} | ${String(lang.lines).padStart(7)} | ${(String(pct) + '%').padStart(4)} |`,
    );
  }
  lines.push('');
  const totalLinesDisplayed = codeLanguages.reduce((sum, l) => sum + l.lines, 0);
  lines.push(`**Total Lines of Code:** ${totalLinesDisplayed}`);
  lines.push('');

  return lines;
}
