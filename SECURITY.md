# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
| < 1.0   | No        |

Only the latest release receives security updates.

## Reporting a Vulnerability

If you discover a security vulnerability in codebase-analyzer, please report it responsibly.

**Email**: adityapatni2106@gmail.com

**Please include**:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

**Do NOT** open a public GitHub issue for security vulnerabilities.

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix or mitigation**: Depends on severity, but we aim for 30 days for critical issues

## Security Design

This tool analyzes untrusted repositories. Key security properties:

- **No shell interpolation**: All child processes use `execFile` with argv arrays, never `exec` with string concatenation
- **No eval**: Repository content is never executed or evaluated
- **Secret masking**: Security scan findings report file/line/rule only, never raw secret values
- **Symlink safety**: Symlinks are not followed by default; when enabled, containment checks prevent escaping the repo root
- **Output caps**: External tool output is capped at 50MB with enforced timeouts
- **Path policy**: All file access goes through a centralized file-policy module with .gitignore respect and default excludes
