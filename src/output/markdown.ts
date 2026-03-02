/**
 * Markdown report formatter.
 * Produces reference-format markdown from ReportData.
 */

import * as path from 'node:path';
import type { ReportData, LanguageBreakdown, HealthCheck, FunctionComplexity } from '../core/types.js';

export function formatMarkdown(report: ReportData): string {
  const lines: string[] = [];
  const repoName = path.basename(report.meta.directory);

  // Header
  lines.push(`# Codebase Analysis: ${repoName}`);
  lines.push(`**Generated:** ${formatDate(report.meta.generatedAt)}`);
  lines.push(`**Directory:** \`${report.meta.directory}\``);
  lines.push('---');

  // Summary
  lines.push('## Summary');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total Files (tracked) | ${report.sizing.totalFiles} |`);
  lines.push('');

  // Language Breakdown
  if (report.sizing.meta.status === 'computed' && report.sizing.languages.length > 0) {
    lines.push('## Language Breakdown');
    lines.push('| Extension | Files | Lines | % of Code |');
    lines.push('|-----------|-------|-------|-----------|');
    const sorted = [...report.sizing.languages].sort((a, b) => b.lines - a.lines);
    for (const lang of sorted) {
      lines.push(
        `| ${padRight(lang.extension, 10)} | ${padLeft(String(lang.files), 5)} | ${padLeft(String(lang.lines), 7)} | ${padLeft(String(lang.percentOfCode) + '%', 4)} |`,
      );
    }
    lines.push('');
    lines.push(`**Total Lines of Code:** ${report.sizing.totalLines}`);
    lines.push('');
  }

  // Folder Structure
  if (report.structure.meta.status === 'computed') {
    lines.push('## Folder Structure');
    lines.push('');
    lines.push('```');
    lines.push(report.structure.treeString);
    lines.push('```');
    lines.push('');
  }

  // Test Analysis
  lines.push('## Test Analysis');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Test Files | ${report.testAnalysis.testFiles} |`);
  lines.push(`| Test Lines | ${report.testAnalysis.testLines} |`);
  lines.push(`| Code Lines (non-test) | ${report.testAnalysis.codeLines} |`);
  lines.push(`| Test/Code Ratio | ${report.testAnalysis.testCodeRatio}% |`);

  if (report.testAnalysis.coverageConfigFound) {
    lines.push('### Coverage Configuration');
    lines.push('');
    lines.push('- **Coverage Reports**: Coverage configuration found');
    lines.push('');
  }

  if (report.testAnalysis.testFrameworks.length > 0) {
    lines.push('### Test Frameworks Detected');
    lines.push('');
    for (const fw of report.testAnalysis.testFrameworks) {
      lines.push(`- **${fw}**`);
    }
    lines.push('');
  }

  if (report.testAnalysis.testFileList.length > 0) {
    lines.push('### Test Files');
    lines.push('');
    const topFiles = report.testAnalysis.testFileList.slice(0, 40);
    for (const f of topFiles) {
      lines.push(`- \`${f.path}\` (${f.lines} lines)`);
    }
    if (report.testAnalysis.testFileList.length > 40) {
      lines.push(
        `\n*... and ${report.testAnalysis.testFileList.length - 40} more test files*`,
      );
    }
    lines.push('');
  }

  // Repo Health
  if (report.repoHealth.meta.status === 'computed') {
    lines.push('## Repository Health');
    lines.push('');
    lines.push('| Check | Status | Path |');
    lines.push('|-------|--------|------|');
    for (const check of report.repoHealth.checks) {
      const status = check.present ? 'Present' : 'Missing';
      const icon = check.present ? '+' : '-';
      const filePath = check.path ?? '';
      lines.push(`| ${check.name} | ${icon} ${status} | ${filePath} |`);
    }
    lines.push('');
  }

  // Complexity
  if (report.complexity.meta.status === 'computed') {
    lines.push('## Cyclomatic Complexity');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Average Complexity | ${report.complexity.repoAvgComplexity.toFixed(1)} |`);
    lines.push(`| Max Complexity | ${report.complexity.repoMaxComplexity} |`);
    lines.push(`| Total Functions | ${report.complexity.totalFunctions} |`);
    lines.push('');

    if (report.complexity.hotspots.length > 0) {
      lines.push('### Complexity Hotspots');
      lines.push('');
      lines.push('| Function | File | Line | Complexity |');
      lines.push('|----------|------|------|------------|');
      for (const fn of report.complexity.hotspots) {
        lines.push(`| ${fn.name} | ${fn.file} | ${fn.line} | ${fn.complexity} |`);
      }
      lines.push('');
    }
  }

  // God Files
  if (report.sizing.meta.status === 'computed' && report.sizing.godFiles.length > 0) {
    lines.push('## God Files (>500 LOC)');
    lines.push('');
    lines.push('| File | Lines | Language |');
    lines.push('|------|-------|----------|');
    const sorted = [...report.sizing.godFiles].sort((a, b) => b.lines - a.lines);
    for (const f of sorted) {
      lines.push(`| ${f.path} | ${f.lines} | ${f.language} |`);
    }
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push(
    `*Analysis completeness: ${report.meta.analysisCompleteness}% | Generated by codebase-analyzer v${report.meta.analyzerVersion}*`,
  );

  return lines.join('\n') + '\n';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function padRight(s: string, n: number): string {
  return s.padEnd(n);
}

function padLeft(s: string, n: number): string {
  return s.padStart(n);
}
