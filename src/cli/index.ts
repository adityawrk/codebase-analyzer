#!/usr/bin/env node

/**
 * CLI entry point for codebase-analyzer.
 * Usage: codebase-analyzer analyze <path> [options]
 */

import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { analyzeRepository } from '../core/orchestrator.js';
import { formatMarkdown } from '../output/markdown.js';
import { formatJson } from '../output/json.js';
import { DEFAULT_CONFIG } from '../core/types.js';
import type { AnalysisConfig } from '../core/types.js';

const program = new Command();

program
  .name('codebase-analyzer')
  .description('Self-hosted static analysis CLI for codebase reports')
  .version('0.1.0');

program
  .command('analyze')
  .description('Analyze a codebase and produce a report')
  .argument('<path>', 'Path to the repository to analyze')
  .option('-f, --format <format>', 'Output format: markdown or json', 'markdown')
  .option('-o, --output <file>', 'Write report to file instead of stdout')
  .option('--offline', 'Skip external tool calls', false)
  .option('--timeout <ms>', 'Per-tool timeout in milliseconds', '60000')
  .option('--include <patterns...>', 'Include glob patterns')
  .option('--exclude <patterns...>', 'Exclude glob patterns')
  .option('--follow-symlinks', 'Follow symlinks within repo root', false)
  .option('--max-file-size <bytes>', 'Max file size to analyze', '1048576')
  .action(async (repoPath: string, options: Record<string, unknown>) => {
    const absolutePath = path.resolve(repoPath);

    // Verify path exists
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isDirectory()) {
        console.error(`Error: ${absolutePath} is not a directory`);
        process.exit(1);
      }
    } catch {
      console.error(`Error: ${absolutePath} does not exist`);
      process.exit(1);
    }

    const format = options.format as string;
    if (format !== 'markdown' && format !== 'json') {
      console.error(`Error: Invalid format "${format}". Use "markdown" or "json".`);
      process.exit(1);
    }

    const config: AnalysisConfig = {
      ...DEFAULT_CONFIG,
      root: absolutePath,
      format: format as 'markdown' | 'json',
      outputPath: (options.output as string) ?? null,
      offline: options.offline as boolean,
      timeout: parseInt(options.timeout as string, 10),
      include: (options.include as string[]) ?? [],
      exclude: (options.exclude as string[]) ?? [],
      followSymlinks: options.followSymlinks as boolean,
      maxFileSize: parseInt(options.maxFileSize as string, 10),
    };

    const startTime = performance.now();

    try {
      const report = await analyzeRepository(absolutePath, config);
      const output = format === 'json' ? formatJson(report) : formatMarkdown(report);

      if (config.outputPath) {
        await fs.writeFile(config.outputPath, output, 'utf-8');
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
        console.error(`Report written to ${config.outputPath} (${elapsed}s)`);
      } else {
        process.stdout.write(output);
      }
    } catch (err) {
      console.error('Analysis failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
