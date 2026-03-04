/**
 * Report header section formatter.
 */

import * as path from 'node:path';
import type { ReportData } from '../../core/types.js';
import { formatDate } from './helpers.js';

export function formatHeader(report: ReportData): string[] {
  const repoName = path.basename(report.meta.directory);
  return [
    `# Codebase Analysis: ${repoName}`,
    `**Generated:** ${formatDate(report.meta.generatedAt)}`,
    `**Directory:** \`${path.basename(report.meta.directory)}\``,
    '---',
  ];
}
