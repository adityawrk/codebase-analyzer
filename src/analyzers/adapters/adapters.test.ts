/**
 * Tests for all dependency adapters: npm, cargo, go, pypi.
 *
 * Uses temp files created in os.tmpdir() for isolation. Each test group
 * cleans up after itself via afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseNpmManifest } from './npm-adapter.js';
import { parseCargoManifest } from './cargo-adapter.js';
import { parseGoMod } from './go-adapter.js';
import { parsePythonRequirements } from './pypi-adapter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'adapter-test-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/** Write a file relative to tmpRoot and return its relative path. */
async function writeFixture(relativePath: string, content: string): Promise<string> {
  const absPath = path.join(tmpRoot, relativePath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, content, 'utf-8');
  return relativePath;
}

// ===========================================================================
// npm-adapter
// ===========================================================================

describe('parseNpmManifest', () => {
  it('parses dependencies and devDependencies', async () => {
    const manifestPath = await writeFixture('package.json', JSON.stringify({
      dependencies: {
        'express': '^4.18.0',
        'lodash': '~4.17.21',
      },
      devDependencies: {
        'typescript': '^5.0.0',
        'vitest': '^1.0.0',
      },
    }));

    const entries = await parseNpmManifest(tmpRoot, manifestPath);

    expect(entries).toHaveLength(4);

    const direct = entries.filter((e) => e.type === 'direct');
    const dev = entries.filter((e) => e.type === 'dev');

    expect(direct).toHaveLength(2);
    expect(dev).toHaveLength(2);

    expect(direct.map((e) => e.name)).toContain('express');
    expect(dev.map((e) => e.name)).toContain('typescript');

    for (const entry of entries) {
      expect(entry.ecosystem).toBe('npm');
    }
  });

  it('parses peer and optional dependencies', async () => {
    const manifestPath = await writeFixture('package.json', JSON.stringify({
      peerDependencies: {
        'react': '>=18',
      },
      optionalDependencies: {
        'fsevents': '^2.3.0',
      },
    }));

    const entries = await parseNpmManifest(tmpRoot, manifestPath);

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.name === 'react')?.type).toBe('peer');
    expect(entries.find((e) => e.name === 'fsevents')?.type).toBe('optional');
  });

  it('returns empty array for missing file', async () => {
    const entries = await parseNpmManifest(tmpRoot, 'nonexistent/package.json');
    expect(entries).toEqual([]);
  });

  it('returns empty array for malformed JSON', async () => {
    const manifestPath = await writeFixture('package.json', '{not valid json');
    const entries = await parseNpmManifest(tmpRoot, manifestPath);
    expect(entries).toEqual([]);
  });

  it('returns empty array when no dependency fields exist', async () => {
    const manifestPath = await writeFixture('package.json', JSON.stringify({
      name: 'my-package',
      version: '1.0.0',
    }));
    const entries = await parseNpmManifest(tmpRoot, manifestPath);
    expect(entries).toEqual([]);
  });
});

// ===========================================================================
// cargo-adapter
// ===========================================================================

describe('parseCargoManifest', () => {
  it('parses simple Cargo.toml with dependencies', async () => {
    const manifestPath = await writeFixture('Cargo.toml', `
[package]
name = "my-app"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = "1.28"
`);

    const entries = await parseCargoManifest(tmpRoot, manifestPath);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      name: 'serde',
      version: '1.0',
      type: 'direct',
      ecosystem: 'cargo',
    });
    expect(entries[1]).toEqual({
      name: 'tokio',
      version: '1.28',
      type: 'direct',
      ecosystem: 'cargo',
    });
  });

  it('parses dev-dependencies', async () => {
    const manifestPath = await writeFixture('Cargo.toml', `
[dependencies]
serde = "1.0"

[dev-dependencies]
criterion = "0.5"
tempfile = "3.8"
`);

    const entries = await parseCargoManifest(tmpRoot, manifestPath);

    expect(entries).toHaveLength(3);

    const direct = entries.filter((e) => e.type === 'direct');
    const dev = entries.filter((e) => e.type === 'dev');

    expect(direct).toHaveLength(1);
    expect(direct[0]!.name).toBe('serde');

    expect(dev).toHaveLength(2);
    expect(dev.map((e) => e.name)).toContain('criterion');
    expect(dev.map((e) => e.name)).toContain('tempfile');
  });

  it('handles table-style deps: package = { version = "1.0" }', async () => {
    const manifestPath = await writeFixture('Cargo.toml', `
[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1.28", features = ["full"] }
my-local-crate = { path = "../my-crate" }
`);

    const entries = await parseCargoManifest(tmpRoot, manifestPath);

    expect(entries).toHaveLength(3);

    expect(entries[0]).toEqual({
      name: 'serde',
      version: '1.0',
      type: 'direct',
      ecosystem: 'cargo',
    });

    expect(entries[1]).toEqual({
      name: 'tokio',
      version: '1.28',
      type: 'direct',
      ecosystem: 'cargo',
    });

    // Path-only dep: no explicit version, should get '*'
    expect(entries[2]).toEqual({
      name: 'my-local-crate',
      version: '*',
      type: 'direct',
      ecosystem: 'cargo',
    });
  });

  it('handles build-dependencies as dev type', async () => {
    const manifestPath = await writeFixture('Cargo.toml', `
[build-dependencies]
cc = "1.0"
`);

    const entries = await parseCargoManifest(tmpRoot, manifestPath);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe('dev');
    expect(entries[0]!.name).toBe('cc');
  });

  it('returns empty array for missing file', async () => {
    const entries = await parseCargoManifest(tmpRoot, 'nonexistent/Cargo.toml');
    expect(entries).toEqual([]);
  });

  it('returns empty array for empty file', async () => {
    const manifestPath = await writeFixture('Cargo.toml', '');
    const entries = await parseCargoManifest(tmpRoot, manifestPath);
    expect(entries).toEqual([]);
  });

  it('ignores sections that are not dependency sections', async () => {
    const manifestPath = await writeFixture('Cargo.toml', `
[package]
name = "my-app"
version = "0.1.0"
edition = "2021"

[profile.release]
opt-level = 3
`);

    const entries = await parseCargoManifest(tmpRoot, manifestPath);
    expect(entries).toEqual([]);
  });

  it('handles comments in Cargo.toml', async () => {
    const manifestPath = await writeFixture('Cargo.toml', `
[dependencies]
# This is a comment
serde = "1.0"
# Another comment
tokio = "1.28"
`);

    const entries = await parseCargoManifest(tmpRoot, manifestPath);
    expect(entries).toHaveLength(2);
  });

  it('parses [workspace.dependencies] as direct', async () => {
    const manifestPath = await writeFixture('Cargo.toml', `
[workspace]
members = ["crates/*"]

[workspace.dependencies]
serde = "1.0"
tokio = { version = "1.28", features = ["full"] }
`);

    const entries = await parseCargoManifest(tmpRoot, manifestPath);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      name: 'serde',
      version: '1.0',
      type: 'direct',
      ecosystem: 'cargo',
    });
    expect(entries[1]).toEqual({
      name: 'tokio',
      version: '1.28',
      type: 'direct',
      ecosystem: 'cargo',
    });
  });

  it('parses [target.*.dependencies] sections', async () => {
    const manifestPath = await writeFixture('Cargo.toml', `
[dependencies]
serde = "1.0"

[target.'cfg(target_os = "linux")'.dependencies]
nix = "0.27"

[target.'cfg(target_os = "windows")'.dependencies]
winapi = "0.3"
`);

    const entries = await parseCargoManifest(tmpRoot, manifestPath);

    expect(entries).toHaveLength(3);

    const names = entries.map((e) => e.name);
    expect(names).toContain('serde');
    expect(names).toContain('nix');
    expect(names).toContain('winapi');

    for (const entry of entries) {
      expect(entry.type).toBe('direct');
    }
  });

  it('parses [target.*.dev-dependencies] as dev type', async () => {
    const manifestPath = await writeFixture('Cargo.toml', `
[target.'cfg(unix)'.dev-dependencies]
nix = "0.27"

[target.'cfg(windows)'.build-dependencies]
winres = "0.1"
`);

    const entries = await parseCargoManifest(tmpRoot, manifestPath);

    expect(entries).toHaveLength(2);

    expect(entries[0]).toEqual({
      name: 'nix',
      version: '0.27',
      type: 'dev',
      ecosystem: 'cargo',
    });

    expect(entries[1]).toEqual({
      name: 'winres',
      version: '0.1',
      type: 'dev',
      ecosystem: 'cargo',
    });
  });

  it('mixes standard, workspace, and target sections', async () => {
    const manifestPath = await writeFixture('Cargo.toml', `
[package]
name = "my-app"

[dependencies]
serde = "1.0"

[dev-dependencies]
criterion = "0.5"

[workspace.dependencies]
shared-lib = { path = "../shared" }

[target.'cfg(unix)'.dependencies]
nix = "0.27"
`);

    const entries = await parseCargoManifest(tmpRoot, manifestPath);

    expect(entries).toHaveLength(4);

    expect(entries.find((e) => e.name === 'serde')?.type).toBe('direct');
    expect(entries.find((e) => e.name === 'criterion')?.type).toBe('dev');
    expect(entries.find((e) => e.name === 'shared-lib')?.type).toBe('direct');
    expect(entries.find((e) => e.name === 'nix')?.type).toBe('direct');
  });
});

// ===========================================================================
// go-adapter
// ===========================================================================

describe('parseGoMod', () => {
  it('parses go.mod with require block', async () => {
    const manifestPath = await writeFixture('go.mod', `
module github.com/myorg/myapp

go 1.21

require (
\tgithub.com/gin-gonic/gin v1.9.1
\tgithub.com/stretchr/testify v1.8.4
\tgolang.org/x/sync v0.3.0
)
`);

    const entries = await parseGoMod(tmpRoot, manifestPath);

    expect(entries).toHaveLength(3);

    expect(entries[0]).toEqual({
      name: 'github.com/gin-gonic/gin',
      version: 'v1.9.1',
      type: 'direct',
      ecosystem: 'go',
    });

    expect(entries[1]).toEqual({
      name: 'github.com/stretchr/testify',
      version: 'v1.8.4',
      type: 'direct',
      ecosystem: 'go',
    });

    for (const entry of entries) {
      expect(entry.ecosystem).toBe('go');
    }
  });

  it('marks indirect deps correctly', async () => {
    const manifestPath = await writeFixture('go.mod', `
module github.com/myorg/myapp

go 1.21

require (
\tgithub.com/gin-gonic/gin v1.9.1
\tgithub.com/bytedance/sonic v1.9.1 // indirect
\tgithub.com/pelletier/go-toml/v2 v2.0.8 // indirect
)
`);

    const entries = await parseGoMod(tmpRoot, manifestPath);

    expect(entries).toHaveLength(3);

    const direct = entries.filter((e) => e.type === 'direct');
    const indirect = entries.filter((e) => e.type === 'optional');

    expect(direct).toHaveLength(1);
    expect(direct[0]!.name).toBe('github.com/gin-gonic/gin');

    expect(indirect).toHaveLength(2);
    expect(indirect.map((e) => e.name)).toContain('github.com/bytedance/sonic');
    expect(indirect.map((e) => e.name)).toContain('github.com/pelletier/go-toml/v2');
  });

  it('handles single-line require', async () => {
    const manifestPath = await writeFixture('go.mod', `
module github.com/myorg/myapp

go 1.21

require github.com/gin-gonic/gin v1.9.1
`);

    const entries = await parseGoMod(tmpRoot, manifestPath);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      name: 'github.com/gin-gonic/gin',
      version: 'v1.9.1',
      type: 'direct',
      ecosystem: 'go',
    });
  });

  it('handles mixed single-line and block requires', async () => {
    const manifestPath = await writeFixture('go.mod', `
module github.com/myorg/myapp

go 1.21

require github.com/standalone/pkg v0.1.0

require (
\tgithub.com/gin-gonic/gin v1.9.1
\tgithub.com/stretchr/testify v1.8.4
)
`);

    const entries = await parseGoMod(tmpRoot, manifestPath);

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.name)).toContain('github.com/standalone/pkg');
    expect(entries.map((e) => e.name)).toContain('github.com/gin-gonic/gin');
    expect(entries.map((e) => e.name)).toContain('github.com/stretchr/testify');
  });

  it('returns empty array for missing file', async () => {
    const entries = await parseGoMod(tmpRoot, 'nonexistent/go.mod');
    expect(entries).toEqual([]);
  });

  it('returns empty array for empty file', async () => {
    const manifestPath = await writeFixture('go.mod', '');
    const entries = await parseGoMod(tmpRoot, manifestPath);
    expect(entries).toEqual([]);
  });

  it('ignores non-require directives', async () => {
    const manifestPath = await writeFixture('go.mod', `
module github.com/myorg/myapp

go 1.21

replace github.com/old/pkg => github.com/new/pkg v1.0.0

exclude github.com/bad/pkg v0.1.0
`);

    const entries = await parseGoMod(tmpRoot, manifestPath);
    expect(entries).toEqual([]);
  });
});

// ===========================================================================
// pypi-adapter (requirements.txt)
// ===========================================================================

describe('parsePythonRequirements — requirements.txt', () => {
  it('parses requirements.txt', async () => {
    const manifestPath = await writeFixture('requirements.txt', `
requests==2.31.0
flask>=2.0.0
numpy~=1.24.0
pandas
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(4);

    expect(entries[0]).toEqual({
      name: 'requests',
      version: '==2.31.0',
      type: 'direct',
      ecosystem: 'pypi',
    });

    expect(entries[1]).toEqual({
      name: 'flask',
      version: '>=2.0.0',
      type: 'direct',
      ecosystem: 'pypi',
    });

    expect(entries[2]).toEqual({
      name: 'numpy',
      version: '~=1.24.0',
      type: 'direct',
      ecosystem: 'pypi',
    });

    expect(entries[3]).toEqual({
      name: 'pandas',
      version: '*',
      type: 'direct',
      ecosystem: 'pypi',
    });
  });

  it('skips comments and blank lines', async () => {
    const manifestPath = await writeFixture('requirements.txt', `
# This is a comment
requests==2.31.0

# Another comment

flask>=2.0.0
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name)).toEqual(['requests', 'flask']);
  });

  it('handles version specifiers (==, >=, ~=)', async () => {
    const manifestPath = await writeFixture('requirements.txt', `
exact==1.0.0
minimum>=2.0.0
compatible~=3.0.0
ranged>=1.0,<2.0
bare-package
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(5);
    expect(entries[0]!.version).toBe('==1.0.0');
    expect(entries[1]!.version).toBe('>=2.0.0');
    expect(entries[2]!.version).toBe('~=3.0.0');
    expect(entries[3]!.version).toBe('>=1.0,<2.0');
    expect(entries[4]!.version).toBe('*');
  });

  it('skips -r references and -e editable installs', async () => {
    const manifestPath = await writeFixture('requirements.txt', `
-r base-requirements.txt
-e git+https://github.com/org/repo.git#egg=mypackage
requests==2.31.0
--index-url https://pypi.org/simple
flask>=2.0.0
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name)).toEqual(['requests', 'flask']);
  });

  it('strips inline comments', async () => {
    const manifestPath = await writeFixture('requirements.txt', `
requests==2.31.0  # HTTP library
flask>=2.0.0 # Web framework
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe('requests');
    expect(entries[1]!.name).toBe('flask');
  });

  it('strips extras from package names', async () => {
    const manifestPath = await writeFixture('requirements.txt', `
boto3[crt]>=1.0
requests[security]>=2.0
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe('boto3');
    expect(entries[1]!.name).toBe('requests');
  });

  it('returns empty array for missing file', async () => {
    const entries = await parsePythonRequirements(tmpRoot, 'nonexistent/requirements.txt');
    expect(entries).toEqual([]);
  });

  it('returns empty array for empty file', async () => {
    const manifestPath = await writeFixture('requirements.txt', '');
    const entries = await parsePythonRequirements(tmpRoot, manifestPath);
    expect(entries).toEqual([]);
  });
});

// ===========================================================================
// pypi-adapter (pyproject.toml)
// ===========================================================================

describe('parsePythonRequirements — pyproject.toml', () => {
  it('parses pyproject.toml dependencies section', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[project]
name = "my-project"
version = "1.0.0"
dependencies = [
    "requests>=2.31.0",
    "flask>=2.0.0",
    "click",
]
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(3);

    expect(entries[0]).toEqual({
      name: 'requests',
      version: '>=2.31.0',
      type: 'direct',
      ecosystem: 'pypi',
    });

    expect(entries[1]).toEqual({
      name: 'flask',
      version: '>=2.0.0',
      type: 'direct',
      ecosystem: 'pypi',
    });

    expect(entries[2]).toEqual({
      name: 'click',
      version: '*',
      type: 'direct',
      ecosystem: 'pypi',
    });
  });

  it('parses optional-dependencies as type optional', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[project]
name = "my-project"
version = "1.0.0"
dependencies = [
    "requests>=2.31.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "mypy>=1.0",
]
docs = [
    "sphinx>=6.0",
]
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(4);

    const direct = entries.filter((e) => e.type === 'direct');
    const optional = entries.filter((e) => e.type === 'optional');

    expect(direct).toHaveLength(1);
    expect(direct[0]!.name).toBe('requests');

    expect(optional).toHaveLength(3);
    expect(optional.map((e) => e.name)).toContain('pytest');
    expect(optional.map((e) => e.name)).toContain('mypy');
    expect(optional.map((e) => e.name)).toContain('sphinx');
  });

  it('handles inline dependencies array', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[project]
name = "my-project"
dependencies = ["requests>=2.0", "flask"]
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe('requests');
    expect(entries[1]!.name).toBe('flask');
  });

  it('returns empty for missing file', async () => {
    const entries = await parsePythonRequirements(tmpRoot, 'nonexistent/pyproject.toml');
    expect(entries).toEqual([]);
  });

  it('returns empty for pyproject.toml with no dependencies', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[project]
name = "my-project"
version = "1.0.0"

[build-system]
requires = ["setuptools"]
build-backend = "setuptools.build_meta"
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);
    expect(entries).toEqual([]);
  });

  it('strips extras from pyproject.toml package names', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[project]
name = "my-project"
dependencies = [
    "boto3[crt]>=1.0",
    "uvicorn[standard]>=0.20",
]
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe('boto3');
    expect(entries[1]!.name).toBe('uvicorn');
  });
});

// ===========================================================================
// pypi-adapter (pyproject.toml — Poetry layout)
// ===========================================================================

describe('parsePythonRequirements — pyproject.toml (Poetry)', () => {
  it('parses [tool.poetry.dependencies] as direct deps', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[tool.poetry]
name = "my-poetry-project"
version = "1.0.0"

[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28"
flask = "^2.3"
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.name === 'python')).toBeUndefined();

    expect(entries[0]).toEqual({
      name: 'requests',
      version: '^2.28',
      type: 'direct',
      ecosystem: 'pypi',
    });

    expect(entries[1]).toEqual({
      name: 'flask',
      version: '^2.3',
      type: 'direct',
      ecosystem: 'pypi',
    });
  });

  it('parses [tool.poetry.group.dev.dependencies] as dev deps', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28"

[tool.poetry.group.dev.dependencies]
pytest = "^7.0"
mypy = "^1.0"
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(3);

    const direct = entries.filter((e) => e.type === 'direct');
    const dev = entries.filter((e) => e.type === 'dev');

    expect(direct).toHaveLength(1);
    expect(direct[0]!.name).toBe('requests');

    expect(dev).toHaveLength(2);
    expect(dev.map((e) => e.name)).toContain('pytest');
    expect(dev.map((e) => e.name)).toContain('mypy');
  });

  it('parses [tool.poetry.group.*.dependencies] as optional deps', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28"

[tool.poetry.group.docs.dependencies]
sphinx = "^6.0"
sphinx-rtd-theme = "^1.2"

[tool.poetry.group.test.dependencies]
coverage = "^7.0"
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(4);

    const direct = entries.filter((e) => e.type === 'direct');
    const optional = entries.filter((e) => e.type === 'optional');

    expect(direct).toHaveLength(1);
    expect(direct[0]!.name).toBe('requests');

    expect(optional).toHaveLength(3);
    expect(optional.map((e) => e.name)).toContain('sphinx');
    expect(optional.map((e) => e.name)).toContain('sphinx-rtd-theme');
    expect(optional.map((e) => e.name)).toContain('coverage');
  });

  it('handles Poetry table-style deps: package = {version = "^2.28", optional = true}', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[tool.poetry.dependencies]
python = "^3.9"
requests = {version = "^2.28", optional = true}
boto3 = {version = "^1.26", extras = ["crt"]}
local-pkg = {path = "../local"}
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(3);

    expect(entries[0]).toEqual({
      name: 'requests',
      version: '^2.28',
      type: 'direct',
      ecosystem: 'pypi',
    });

    expect(entries[1]).toEqual({
      name: 'boto3',
      version: '^1.26',
      type: 'direct',
      ecosystem: 'pypi',
    });

    // Path-only dep: no version, should get '*'
    expect(entries[2]).toEqual({
      name: 'local-pkg',
      version: '*',
      type: 'direct',
      ecosystem: 'pypi',
    });
  });

  it('handles legacy [tool.poetry.dev-dependencies] section', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28"

[tool.poetry.dev-dependencies]
pytest = "^7.0"
flake8 = "^6.0"
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(3);

    const direct = entries.filter((e) => e.type === 'direct');
    const dev = entries.filter((e) => e.type === 'dev');

    expect(direct).toHaveLength(1);
    expect(direct[0]!.name).toBe('requests');

    expect(dev).toHaveLength(2);
    expect(dev.map((e) => e.name)).toContain('pytest');
    expect(dev.map((e) => e.name)).toContain('flake8');
  });

  it('combines PEP 621 and Poetry dependencies when both exist', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[project]
name = "hybrid-project"
dependencies = [
    "click>=8.0",
]

[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28"

[tool.poetry.group.dev.dependencies]
pytest = "^7.0"
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);

    expect(entries).toHaveLength(3);
    expect(entries.find((e) => e.name === 'click')?.type).toBe('direct');
    expect(entries.find((e) => e.name === 'requests')?.type).toBe('direct');
    expect(entries.find((e) => e.name === 'pytest')?.type).toBe('dev');
  });

  it('returns empty for pyproject.toml with only Poetry metadata (no deps)', async () => {
    const manifestPath = await writeFixture('pyproject.toml', `
[tool.poetry]
name = "my-project"
version = "1.0.0"
description = "A project"
`);

    const entries = await parsePythonRequirements(tmpRoot, manifestPath);
    expect(entries).toEqual([]);
  });
});
