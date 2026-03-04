/**
 * JSON report formatter.
 * Outputs machine-readable JSON conforming to schemas/report-v1.schema.json.
 */

import * as path from 'node:path';
import type { ReportData } from '../core/types.js';

export function formatJson(report: ReportData): string {
  // Strip full local path from meta.directory — only output the directory name.
  const sanitized: ReportData = {
    ...report,
    meta: {
      ...report.meta,
      directory: path.basename(report.meta.directory),
    },
  };
  return JSON.stringify(sanitized, null, 2) + '\n';
}
