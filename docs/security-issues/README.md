# Security Issues — Archived Writeups

> **⚠️ This directory contains archived individual finding writeups.**
> **The consolidated security inventory is at [`docs/SECURITY_FINDINGS.md`](../SECURITY_FINDINGS.md).**

## Active Issue Trackers

Only open findings have active trackers:

| ID      | Title                                          | Severity | Tracker                                  |
| ------- | ---------------------------------------------- | -------- | ---------------------------------------- |
| SEC-015 | Security Policy References Upstream Repository | Info     | [tracker-SEC-015.md](tracker-SEC-015.md) |

## Archived Writeups

The following files in this directory are archived reference material for resolved/mitigated
findings. They are retained for audit trail purposes but are no longer actively maintained.
See [SECURITY_FINDINGS.md](../SECURITY_FINDINGS.md) for current statuses.

| File                                   | Finding                                 | Status       |
| -------------------------------------- | --------------------------------------- | ------------ |
| `SEC-001-json-schema-validation.md`    | JSON Parsing Without Schema Validation  | ✅ Resolved  |
| `SEC-002-insecure-file-permissions.md` | Insecure File Permissions               | ✅ Resolved  |
| `SEC-003-sensitive-data-in-logs.md`    | Sensitive Data Exposure in Logs         | ✅ Resolved  |
| `SEC-004-content-security-policy.md`   | Missing Content Security Policy         | ✅ Resolved  |
| `SEC-006-unencrypted-transport.md`     | Unencrypted Local Transport             | ✅ Resolved  |
| `SEC-007-rate-limiting.md`             | Missing Rate Limiting                   | ✅ Resolved  |
| `SEC-008-audit-logging.md`             | No Formal Audit Logging                 | ✅ Resolved  |
| `SEC-011-jsonl-line-length.md`         | JSONL Input Length Validation           | ✅ Resolved  |
| `SEC-012-debug-logging-config.md`      | Debug Logging Configuration             | ✅ Resolved  |
| `tracker-SEC-014.md`                   | Symlink Attack Surface on File Watchers | ✅ Resolved  |
| `SEC-017-vite-path-traversal.md`       | Vite Path Traversal Vulnerabilities     | ✅ Mitigated |
| `SEC-018-logging-bypass.md`            | Console Logging Bypass                  | ✅ Resolved  |
| `VERIFY-mitigated-findings.md`         | Verification of Mitigated Findings      | ✅ Verified  |

## Related Documents

- **[Consolidated Security Findings](../SECURITY_FINDINGS.md)** — Single source of truth
- [SECURITY.md](../../SECURITY.md) — Security policy and vulnerability reporting
- [Security Issue Template](../../.github/ISSUE_TEMPLATE/security_finding.yml) — GitHub issue template

---

_Last updated: 2026-04-26_
