/**
 * Core type definitions for the codebase analyzer.
 * All shared interfaces live here — no circular imports.
 */

// --- File & Language ---

export interface FileEntry {
  /** Relative path from repo root (forward slashes) */
  path: string;
  /** Detected programming language */
  language: string;
  /** File extension (with dot, e.g. ".ts") */
  extension: string;
  /** File size in bytes */
  size: number;
  /** Whether this file is a test file */
  isTest: boolean;
  /** Whether this file is binary */
  isBinary: boolean;
}

export type ManifestType =
  | 'npm'
  | 'cargo'
  | 'go'
  | 'python-requirements'
  | 'python-pyproject'
  | 'maven'
  | 'gradle';

export interface ManifestEntry {
  type: ManifestType;
  path: string;
}

// --- Git Metadata ---

export interface GitMeta {
  isRepo: boolean;
  remotes: string[];
  headCommit: string | null;
  defaultBranch: string | null;
  totalCommits: number | null;
  firstCommitDate: string | null;
  lastCommitDate: string | null;
}

// --- Analysis Config ---

export interface AnalysisConfig {
  /** Repo root path (absolute) */
  root: string;
  /** Output format */
  format: 'markdown' | 'json';
  /** Output file path (null = stdout) */
  outputPath: string | null;
  /** Include glob patterns */
  include: string[];
  /** Exclude glob patterns */
  exclude: string[];
  /** Per-tool timeout in ms */
  timeout: number;
  /** Skip external tool calls */
  offline: boolean;
  /** Follow symlinks (within repo root only) */
  followSymlinks: boolean;
  /** Max file size to analyze (bytes) */
  maxFileSize: number;
}

export const DEFAULT_CONFIG: Omit<AnalysisConfig, 'root'> = {
  format: 'markdown',
  outputPath: null,
  include: [],
  exclude: [],
  timeout: 60_000,
  offline: false,
  followSymlinks: false,
  maxFileSize: 1_048_576, // 1MB
};

// --- Repository Index ---

export interface RepositoryIndex {
  /** Absolute path to repo root */
  root: string;
  /** All tracked files */
  files: readonly FileEntry[];
  /** Files grouped by language */
  filesByLanguage: ReadonlyMap<string, readonly FileEntry[]>;
  /** Files grouped by extension */
  filesByExtension: ReadonlyMap<string, readonly FileEntry[]>;
  /** Detected manifest files */
  manifests: readonly ManifestEntry[];
  /** Git repository metadata */
  gitMeta: GitMeta;
  /** Resolved analysis config */
  config: AnalysisConfig;
}

// --- Exec ---

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface ExecToolError {
  tool: string;
  exitCode: number;
  stderr: string;
  timedOut: boolean;
}

// --- Analyzer Results ---

export type AnalyzerStatus = 'computed' | 'skipped' | 'error';

export interface AnalyzerMeta {
  status: AnalyzerStatus;
  reason?: string;
  durationMs: number;
}

// -- Sizing --

export interface LanguageBreakdown {
  language: string;
  extension: string;
  files: number;
  lines: number;
  codeLines: number;
  blankLines: number;
  commentLines: number;
  percentOfCode: number;
}

export interface GodFile {
  path: string;
  lines: number;
  language: string;
}

export interface SizingResult {
  meta: AnalyzerMeta;
  totalFiles: number;
  totalLines: number;
  totalCodeLines: number;
  totalBlankLines: number;
  totalCommentLines: number;
  languages: LanguageBreakdown[];
  godFiles: GodFile[];
}

// -- Structure --

export interface FolderNode {
  name: string;
  fileCount: number;
  children: FolderNode[];
}

export interface StructureResult {
  meta: AnalyzerMeta;
  tree: FolderNode;
  treeString: string;
}

// -- Repo Health --

export interface HealthCheck {
  name: string;
  present: boolean;
  path?: string;
  note?: string;
}

export interface RepoHealthResult {
  meta: AnalyzerMeta;
  checks: HealthCheck[];
}

// -- Complexity --

export interface FunctionComplexity {
  name: string;
  file: string;
  line: number;
  complexity: number;
}

export interface FileComplexity {
  file: string;
  avgComplexity: number;
  maxComplexity: number;
  functionCount: number;
  functions: FunctionComplexity[];
}

export interface ComplexityResult {
  meta: AnalyzerMeta;
  repoAvgComplexity: number;
  repoMaxComplexity: number;
  totalFunctions: number;
  fileComplexities: FileComplexity[];
  hotspots: FunctionComplexity[];
}

// -- Test Analysis --

export interface TestAnalysis {
  meta: AnalyzerMeta;
  testFiles: number;
  testLines: number;
  codeLines: number;
  testCodeRatio: number;
  testFrameworks: string[];
  coverageConfigFound: boolean;
  testFileList: Array<{ path: string; lines: number }>;
}

// -- Git Analysis --

export interface ContributorInfo {
  name: string;
  email: string;
  commits: number;
}

export interface GitAnalysisResult {
  meta: AnalyzerMeta;
  totalCommits: number;
  contributors: number;
  firstCommitDate: string | null;
  lastCommitDate: string | null;
  activeDays: number;
  topContributors: ContributorInfo[];
  conventionalCommitPercent: number;
  busFactor: number;
  commitFrequency: {
    commitsPerWeek: number;
    commitsPerMonth: number;
  };
}

// -- Dependencies --

export interface DependencyEntry {
  name: string;
  version: string;
  type: 'direct' | 'dev' | 'peer' | 'optional';
  ecosystem: string;
}

export interface DependencyResult {
  meta: AnalyzerMeta;
  totalDependencies: number;
  directDependencies: number;
  devDependencies: number;
  ecosystems: string[];
  packageManager: string | null;
  dependencies: DependencyEntry[];
}

// -- Security --

export interface SecurityFinding {
  file: string;
  line: number;
  ruleId: string;
  description: string;
}

export interface SecurityResult {
  meta: AnalyzerMeta;
  secretsFound: number;
  findings: SecurityFinding[];
}

// -- Tech Stack --

export interface TechStackEntry {
  name: string;
  category: 'framework' | 'build-tool' | 'linter' | 'formatter' | 'test-runner' | 'deployment' | 'database' | 'service' | 'language-tool' | 'other';
  source: string;
}

export interface TechStackResult {
  meta: AnalyzerMeta;
  stack: TechStackEntry[];
}

// -- Environment Variables --

export interface EnvVarEntry {
  name: string;
  file: string;
  line: number;
  prefix: string;
}

export interface EnvVarsResult {
  meta: AnalyzerMeta;
  totalVars: number;
  variables: EnvVarEntry[];
  byPrefix: Record<string, number>;
}

// -- Duplication --

export interface ClonePair {
  firstFile: string;
  firstStartLine: number;
  firstEndLine: number;
  secondFile: string;
  secondStartLine: number;
  secondEndLine: number;
  lines: number;
  tokens: number;
}

export interface DuplicationResult {
  meta: AnalyzerMeta;
  duplicateLines: number;
  duplicatePercentage: number;
  totalClones: number;
  clones: ClonePair[];
}

// -- Architecture --

export interface ImportEdge {
  from: string;
  to: string;
}

export interface CircularDependency {
  cycle: string[];
}

export interface ModuleCohesion {
  module: string;
  intraImports: number;
  totalImports: number;
  cohesionRatio: number;
}

export interface ArchitectureResult {
  meta: AnalyzerMeta;
  totalImports: number;
  uniqueModules: number;
  importGraph: ImportEdge[];
  circularDependencies: CircularDependency[];
  moduleCohesion: ModuleCohesion[];
}

// --- Report ---

export interface ReportMeta {
  generatedAt: string;
  analyzerVersion: string;
  directory: string;
  analysisCompleteness: number;
  grade?: string;
  score?: number;
  durationMs?: number;
}

export interface ReportData {
  meta: ReportMeta;
  sizing: SizingResult;
  structure: StructureResult;
  repoHealth: RepoHealthResult;
  complexity: ComplexityResult;
  testAnalysis: TestAnalysis;
  git: GitAnalysisResult;
  dependencies: DependencyResult;
  security: SecurityResult;
  techStack: TechStackResult;
  envVars: EnvVarsResult;
  duplication: DuplicationResult;
  architecture: ArchitectureResult;
  scoring?: ScoringResult;
}

// -- Scoring --

export interface MetricScore {
  score: number;
  maxScore: number;
  label: string;
  value: unknown;
}

export interface CategoryScore {
  score: number;
  maxScore: number;
  metrics: Record<string, MetricScore>;
}

export interface ScoringResult {
  totalScore: number;
  totalPossible: number;
  normalizedScore: number;
  grade: string;
  categories: Record<string, CategoryScore>;
}
