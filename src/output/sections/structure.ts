/**
 * Folder Structure section formatter.
 */

import type { ReportData } from '../../core/types.js';

export function formatStructure(report: ReportData): string[] {
  if (report.structure.meta.status !== 'computed') return [];

  return [
    '## Folder Structure',
    '',
    '```',
    report.structure.treeString,
    '```',
    '',
  ];
}
