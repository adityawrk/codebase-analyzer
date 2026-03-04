/**
 * Git Analysis section formatter.
 */

import type { ReportData } from '../../core/types.js';
import { formatDate } from './helpers.js';

export function formatGit(report: ReportData): string[] {
  if (report.git.meta.status !== 'computed') return [];

  const lines: string[] = [];
  lines.push('## Git Analysis');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Commits | ${report.git.totalCommits} |`);
  lines.push(`| Contributors | ${report.git.contributors} |`);
  lines.push(`| Active Days | ${report.git.activeDays} |`);
  lines.push(`| Bus Factor | ${report.git.busFactor} |`);
  lines.push(`| Conventional Commits | ${report.git.conventionalCommitPercent}% |`);
  if (report.git.firstCommitDate) {
    lines.push(`| First Commit | ${formatDate(report.git.firstCommitDate)} |`);
  }
  if (report.git.lastCommitDate) {
    lines.push(`| Last Commit | ${formatDate(report.git.lastCommitDate)} |`);
  }
  lines.push(`| Commits/Week | ${report.git.commitFrequency.commitsPerWeek.toFixed(1)} |`);
  lines.push(`| Commits/Month | ${report.git.commitFrequency.commitsPerMonth.toFixed(1)} |`);
  lines.push('');

  if (report.git.topContributors.length > 0) {
    lines.push('### Top Contributors');
    lines.push('');
    lines.push('| Name | Email | Commits |');
    lines.push('|------|-------|---------|');
    for (const c of report.git.topContributors) {
      lines.push(`| ${c.name} | ${c.email} | ${c.commits} |`);
    }
    lines.push('');
  }

  // Recent Commits
  if (report.git.recentCommits.length > 0) {
    lines.push('### Recent Commits');
    lines.push('');
    lines.push('| Hash | Message | Author | Age |');
    lines.push('|------|---------|--------|-----|');
    for (const c of report.git.recentCommits) {
      lines.push(`| ${c.hash} | ${c.message} | ${c.author} | ${c.date} |`);
    }
    lines.push('');
  }

  // Commit Message Quality
  lines.push('### Commit Message Quality');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Avg Message Length | ${report.git.avgMessageLength} chars |`);
  lines.push(`| Very Short Messages (<10 chars) | ${report.git.shortMessageCount} |`);
  lines.push(`| Conventional Commits | ${report.git.conventionalCommitPercent}% |`);
  lines.push('');

  // Commits That Include Tests
  lines.push('### Commits That Include Tests');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Commits Touching Test Files | ${report.git.commitsWithTests} |`);
  lines.push(`| % of All Commits | ${report.git.commitsWithTestsPercent}% |`);
  lines.push('');

  return lines;
}
