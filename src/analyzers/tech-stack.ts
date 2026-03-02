/**
 * tech-stack.ts — Tech stack detection analyzer.
 *
 * Detects frameworks, build tools, linters, formatters, test runners,
 * deployment tools, databases, and other technologies by parsing manifest
 * files and checking file presence in the RepositoryIndex.
 *
 * Detection sources:
 * - npm package.json (dependencies + devDependencies)
 * - Cargo.toml (Rust)
 * - go.mod (Go)
 * - pyproject.toml / requirements.txt (Python)
 * - File presence patterns (Dockerfile, CI configs, linter configs, etc.)
 *
 * Never throws — returns error meta on failure.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  RepositoryIndex,
  TechStackResult,
  TechStackEntry,
  AnalyzerMeta,
} from '../core/types.js';

// ---------------------------------------------------------------------------
// Package purpose lookup table
// ---------------------------------------------------------------------------

interface PackagePurpose {
  category: TechStackEntry['category'];
  name: string;
}

type PackagePurposeMap = Record<string, PackagePurpose>;

let cachedPurposeMap: PackagePurposeMap | null = null;

/**
 * Load the package-purposes.json lookup table from the data/ directory.
 * Returns an empty map on failure (graceful degradation).
 */
function loadPackagePurposes(): PackagePurposeMap {
  if (cachedPurposeMap !== null) return cachedPurposeMap;

  try {
    const lookupPath = path.resolve(
      import.meta.dirname,
      '../../data/package-purposes.json',
    );
    const raw = fs.readFileSync(lookupPath, 'utf-8');
    cachedPurposeMap = JSON.parse(raw) as PackagePurposeMap;
    return cachedPurposeMap;
  } catch {
    cachedPurposeMap = {};
    return cachedPurposeMap;
  }
}

// ---------------------------------------------------------------------------
// Manifest file reader (synchronous, never throws)
// ---------------------------------------------------------------------------

function readManifestSync(absPath: string): string {
  try {
    return fs.readFileSync(absPath, 'utf-8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// npm detection (package.json)
// ---------------------------------------------------------------------------

function detectFromNpm(
  root: string,
  manifestPath: string,
): TechStackEntry[] {
  const absPath = path.join(root, manifestPath);
  const content = readManifestSync(absPath);
  if (!content) return [];

  const entries: TechStackEntry[] = [];
  const seen = new Set<string>();

  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };

    const purposeMap = loadPackagePurposes();

    for (const depName of Object.keys(allDeps)) {
      const purpose = purposeMap[depName];
      if (!purpose) continue;

      // Deduplicate by display name (e.g., "@prisma/client" and "prisma" both map to "Prisma")
      if (seen.has(purpose.name)) continue;
      seen.add(purpose.name);

      entries.push({
        name: purpose.name,
        category: purpose.category,
        source: manifestPath,
      });
    }
  } catch {
    // Malformed package.json — skip
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Cargo.toml detection (Rust)
// ---------------------------------------------------------------------------

/** Known Rust crates and their categories. */
const RUST_CRATES: Record<string, { name: string; category: TechStackEntry['category'] }> = {
  'actix-web': { name: 'Actix Web', category: 'framework' },
  axum: { name: 'Axum', category: 'framework' },
  rocket: { name: 'Rocket', category: 'framework' },
  tokio: { name: 'Tokio', category: 'framework' },
  serde: { name: 'Serde', category: 'other' },
  diesel: { name: 'Diesel', category: 'database' },
  sqlx: { name: 'SQLx', category: 'database' },
  'sea-orm': { name: 'SeaORM', category: 'database' },
  warp: { name: 'Warp', category: 'framework' },
  tonic: { name: 'Tonic (gRPC)', category: 'service' },
};

function detectFromCargo(
  root: string,
  manifestPath: string,
): TechStackEntry[] {
  const absPath = path.join(root, manifestPath);
  const content = readManifestSync(absPath);
  if (!content) return [];

  const entries: TechStackEntry[] = [];

  // Simple line-based detection: look for crate names in [dependencies] sections.
  // TOML parsing is not available without a dependency, so we use keyword matching.
  for (const [crate, info] of Object.entries(RUST_CRATES)) {
    // Match patterns like: crate_name = "version" or crate_name = { version = "..." }
    // Cargo.toml uses hyphens in crate names but underscores in TOML keys sometimes.
    const hyphenPattern = crate;
    const underscorePattern = crate.replace(/-/g, '_');

    if (
      content.includes(hyphenPattern) ||
      content.includes(underscorePattern)
    ) {
      entries.push({
        name: info.name,
        category: info.category,
        source: manifestPath,
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// go.mod detection (Go)
// ---------------------------------------------------------------------------

const GO_MODULES: Record<string, { name: string; category: TechStackEntry['category'] }> = {
  'github.com/gin-gonic/gin': { name: 'Gin', category: 'framework' },
  'github.com/labstack/echo': { name: 'Echo', category: 'framework' },
  'github.com/gofiber/fiber': { name: 'Fiber', category: 'framework' },
  'gorm.io/gorm': { name: 'GORM', category: 'database' },
  'github.com/gorilla/mux': { name: 'Gorilla Mux', category: 'framework' },
  'github.com/go-chi/chi': { name: 'Chi', category: 'framework' },
  'github.com/jackc/pgx': { name: 'pgx (PostgreSQL)', category: 'database' },
  'github.com/redis/go-redis': { name: 'go-redis', category: 'database' },
  'go.uber.org/zap': { name: 'Zap (logging)', category: 'other' },
};

function detectFromGoMod(
  root: string,
  manifestPath: string,
): TechStackEntry[] {
  const absPath = path.join(root, manifestPath);
  const content = readManifestSync(absPath);
  if (!content) return [];

  const entries: TechStackEntry[] = [];

  for (const [modulePath, info] of Object.entries(GO_MODULES)) {
    if (content.includes(modulePath)) {
      entries.push({
        name: info.name,
        category: info.category,
        source: manifestPath,
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Python detection (pyproject.toml / requirements.txt)
// ---------------------------------------------------------------------------

const PYTHON_PACKAGES: Record<string, { name: string; category: TechStackEntry['category'] }> = {
  django: { name: 'Django', category: 'framework' },
  flask: { name: 'Flask', category: 'framework' },
  fastapi: { name: 'FastAPI', category: 'framework' },
  sqlalchemy: { name: 'SQLAlchemy', category: 'database' },
  celery: { name: 'Celery', category: 'service' },
  pytest: { name: 'pytest', category: 'test-runner' },
  'django-rest-framework': { name: 'Django REST Framework', category: 'framework' },
  djangorestframework: { name: 'Django REST Framework', category: 'framework' },
  starlette: { name: 'Starlette', category: 'framework' },
  uvicorn: { name: 'Uvicorn', category: 'other' },
  gunicorn: { name: 'Gunicorn', category: 'other' },
  alembic: { name: 'Alembic', category: 'database' },
  ruff: { name: 'Ruff', category: 'linter' },
  black: { name: 'Black', category: 'formatter' },
  mypy: { name: 'mypy', category: 'language-tool' },
  'pydantic': { name: 'Pydantic', category: 'other' },
};

function detectFromPython(
  root: string,
  manifestPath: string,
): TechStackEntry[] {
  const absPath = path.join(root, manifestPath);
  const content = readManifestSync(absPath);
  if (!content) return [];

  const entries: TechStackEntry[] = [];
  const contentLower = content.toLowerCase();

  for (const [pkg, info] of Object.entries(PYTHON_PACKAGES)) {
    // Match package name at word boundaries (requirements.txt lines, pyproject.toml entries)
    if (contentLower.includes(pkg.toLowerCase())) {
      entries.push({
        name: info.name,
        category: info.category,
        source: manifestPath,
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// File presence detection
// ---------------------------------------------------------------------------

interface FilePresenceRule {
  /** Glob-like test function against relative file paths */
  test: (filePath: string) => boolean;
  /** Entry to add when matched */
  entry: Omit<TechStackEntry, 'source'>;
  /** Source label */
  source: string;
}

const FILE_PRESENCE_RULES: FilePresenceRule[] = [
  {
    test: (p) => {
      const normalized = p.replace(/\\/g, '/').toLowerCase();
      return (
        normalized.startsWith('.github/workflows/') &&
        (normalized.endsWith('.yml') || normalized.endsWith('.yaml'))
      );
    },
    entry: { name: 'GitHub Actions', category: 'deployment' },
    source: '.github/workflows/',
  },
  {
    test: (p) => path.basename(p).toLowerCase() === 'dockerfile',
    entry: { name: 'Docker', category: 'deployment' },
    source: 'Dockerfile',
  },
  {
    test: (p) => {
      const bn = path.basename(p).toLowerCase();
      return bn === 'docker-compose.yml' || bn === 'docker-compose.yaml' || bn === 'compose.yml' || bn === 'compose.yaml';
    },
    entry: { name: 'Docker Compose', category: 'deployment' },
    source: 'docker-compose.yml',
  },
  {
    test: (p) => {
      const bn = path.basename(p).toLowerCase();
      return bn.startsWith('.eslintrc') || bn.startsWith('eslint.config');
    },
    entry: { name: 'ESLint', category: 'linter' },
    source: 'eslint config',
  },
  {
    test: (p) => {
      const bn = path.basename(p).toLowerCase();
      return bn.startsWith('.prettierrc') || bn.startsWith('prettier.config');
    },
    entry: { name: 'Prettier', category: 'formatter' },
    source: 'prettier config',
  },
  {
    test: (p) => {
      const bn = path.basename(p).toLowerCase();
      return bn === 'biome.json' || bn === 'biome.jsonc';
    },
    entry: { name: 'Biome', category: 'linter' },
    source: 'biome.json',
  },
  {
    test: (p) => {
      const bn = path.basename(p).toLowerCase();
      return bn.startsWith('tailwind.config');
    },
    entry: { name: 'Tailwind CSS', category: 'framework' },
    source: 'tailwind.config',
  },
  {
    test: (p) => p.toLowerCase() === '.gitlab-ci.yml',
    entry: { name: 'GitLab CI', category: 'deployment' },
    source: '.gitlab-ci.yml',
  },
  {
    test: (p) => {
      const bn = path.basename(p).toLowerCase();
      return bn === 'jenkinsfile';
    },
    entry: { name: 'Jenkins', category: 'deployment' },
    source: 'Jenkinsfile',
  },
  {
    test: (p) => p.replace(/\\/g, '/').toLowerCase() === '.circleci/config.yml',
    entry: { name: 'CircleCI', category: 'deployment' },
    source: '.circleci/config.yml',
  },
  {
    test: (p) => p.toLowerCase() === '.travis.yml',
    entry: { name: 'Travis CI', category: 'deployment' },
    source: '.travis.yml',
  },
  {
    test: (p) => {
      const bn = path.basename(p).toLowerCase();
      return bn === 'vercel.json';
    },
    entry: { name: 'Vercel', category: 'deployment' },
    source: 'vercel.json',
  },
  {
    test: (p) => {
      const bn = path.basename(p).toLowerCase();
      return bn === 'netlify.toml';
    },
    entry: { name: 'Netlify', category: 'deployment' },
    source: 'netlify.toml',
  },
];

function detectFromFilePresence(files: readonly { path: string }[]): TechStackEntry[] {
  const entries: TechStackEntry[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    for (const rule of FILE_PRESENCE_RULES) {
      if (seen.has(rule.entry.name)) continue;

      if (rule.test(file.path)) {
        seen.add(rule.entry.name);
        entries.push({
          name: rule.entry.name,
          category: rule.entry.category,
          source: rule.source,
        });
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Language detection from index
// ---------------------------------------------------------------------------

/** Detect primary languages from the RepositoryIndex filesByLanguage map. */
function detectLanguages(index: RepositoryIndex): TechStackEntry[] {
  const entries: TechStackEntry[] = [];

  // Map well-known language names to tech stack entries
  const languageMap: Record<string, { name: string; category: TechStackEntry['category'] }> = {
    TypeScript: { name: 'TypeScript', category: 'language-tool' },
    JavaScript: { name: 'JavaScript', category: 'language-tool' },
    Python: { name: 'Python', category: 'language-tool' },
    Go: { name: 'Go', category: 'language-tool' },
    Rust: { name: 'Rust', category: 'language-tool' },
    Java: { name: 'Java', category: 'language-tool' },
    Kotlin: { name: 'Kotlin', category: 'language-tool' },
    Ruby: { name: 'Ruby', category: 'language-tool' },
    Swift: { name: 'Swift', category: 'language-tool' },
    'C#': { name: 'C#', category: 'language-tool' },
    C: { name: 'C', category: 'language-tool' },
    'C++': { name: 'C++', category: 'language-tool' },
    PHP: { name: 'PHP', category: 'language-tool' },
    Dart: { name: 'Dart', category: 'language-tool' },
    Elixir: { name: 'Elixir', category: 'language-tool' },
    Scala: { name: 'Scala', category: 'language-tool' },
  };

  for (const [langName, langFiles] of index.filesByLanguage) {
    // Only include languages with actual source files (skip config/data formats)
    const info = languageMap[langName];
    if (info && langFiles.length > 0) {
      entries.push({
        name: info.name,
        category: info.category,
        source: 'file extensions',
      });
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicate entries by name. When duplicate names appear, prefer the entry
 * from a manifest source (package.json, Cargo.toml, etc.) over file presence.
 */
function deduplicateEntries(entries: TechStackEntry[]): TechStackEntry[] {
  const byName = new Map<string, TechStackEntry>();

  for (const entry of entries) {
    const existing = byName.get(entry.name);
    if (!existing) {
      byName.set(entry.name, entry);
      continue;
    }

    // Prefer manifest sources over file-presence sources
    const isManifestSource =
      entry.source.endsWith('.json') ||
      entry.source.endsWith('.toml') ||
      entry.source.endsWith('.txt') ||
      entry.source.endsWith('.mod');

    if (isManifestSource) {
      byName.set(entry.name, entry);
    }
  }

  return [...byName.values()];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the technology stack used in a codebase.
 *
 * Parses manifest files (package.json, Cargo.toml, go.mod, pyproject.toml,
 * requirements.txt) and checks for configuration file presence to identify
 * frameworks, build tools, linters, formatters, test runners, deployment
 * tools, databases, services, and languages.
 *
 * Never throws — returns error meta on failure.
 */
export async function analyzeTechStack(
  index: RepositoryIndex,
): Promise<TechStackResult> {
  const start = performance.now();

  try {
    const allEntries: TechStackEntry[] = [];

    // 1. Detect from manifest files
    for (const manifest of index.manifests) {
      switch (manifest.type) {
        case 'npm':
          allEntries.push(...detectFromNpm(index.root, manifest.path));
          break;
        case 'cargo':
          allEntries.push(...detectFromCargo(index.root, manifest.path));
          break;
        case 'go':
          allEntries.push(...detectFromGoMod(index.root, manifest.path));
          break;
        case 'python-pyproject':
        case 'python-requirements':
          allEntries.push(...detectFromPython(index.root, manifest.path));
          break;
        // maven and gradle are recognized manifest types but not yet implemented
        default:
          break;
      }
    }

    // 2. Detect from file presence (CI, Docker, linter configs, etc.)
    allEntries.push(...detectFromFilePresence(index.files));

    // 3. Detect primary languages from file extensions
    allEntries.push(...detectLanguages(index));

    // 4. Deduplicate
    const stack = deduplicateEntries(allEntries);

    // Sort: group by category, then alphabetically within category
    const categoryOrder: TechStackEntry['category'][] = [
      'language-tool',
      'framework',
      'build-tool',
      'linter',
      'formatter',
      'test-runner',
      'database',
      'service',
      'deployment',
      'other',
    ];

    stack.sort((a, b) => {
      const catA = categoryOrder.indexOf(a.category);
      const catB = categoryOrder.indexOf(b.category);
      if (catA !== catB) return catA - catB;
      return a.name.localeCompare(b.name);
    });

    const durationMs = performance.now() - start;
    const meta: AnalyzerMeta = {
      status: 'computed',
      durationMs,
    };

    return { meta, stack };
  } catch (err: unknown) {
    const durationMs = performance.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const meta: AnalyzerMeta = {
      status: 'error',
      reason: `Tech stack analysis failed: ${message}`,
      durationMs,
    };

    return { meta, stack: [] };
  }
}
