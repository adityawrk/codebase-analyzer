/**
 * JSON report formatter.
 * Outputs machine-readable JSON conforming to schemas/report-v1.schema.json.
 */

import type { ReportData } from '../core/types.js';

export function formatJson(report: ReportData): string {
  return JSON.stringify(report, null, 2) + '\n';
}
