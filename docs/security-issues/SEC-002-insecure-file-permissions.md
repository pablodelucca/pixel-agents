# Security Issue: SEC-002 - Insecure File Permissions on Config & Layout Files

## Finding Details

| Field               | Value                               |
| ------------------- | ----------------------------------- |
| **Finding ID**      | SEC-002                             |
| **Severity**        | High                                |
| **CVSS Score**      | 7.1 (estimated)                     |
| **Category**        | Insecure File Permissions / CWE-732 |
| **Status**          | ✅ Resolved                         |
| **Priority**        | P1 - Immediate (within 7 days)      |
| **Resolution Date** | 2026-04-24                          |

## Description

The configuration file (`~/.pixel-agents/config.json`) and layout file (`~/.pixel-agents/layout.json`) were created without explicit restrictive file permissions. The `fs.mkdirSync()` and `fs.writeFileSync()` calls relied on the system's default `umask`, which on many Linux systems is `0022` — resulting in world-readable files (`0644`) and world-executable/group-readable directories (`0755`).

On multi-user systems (shared development servers, CI/CD runners, containers with shared volumes), other local users could read these files. While the files do not currently contain secrets, the creation pattern was inconsistent with the security posture already established in `server/src/server.ts`, which correctly uses `mode: 0o700` for directories and `mode: 0o600` for files.

## Affected Files

| File                       | Lines  | Issue                                                   |
| -------------------------- | ------ | ------------------------------------------------------- |
| `src/configPersistence.ts` | 29, 33 | `mkdirSync` and `writeFileSync` missing explicit `mode` |
| `src/layoutPersistence.ts` | 47, 51 | `mkdirSync` and `writeFileSync` missing explicit `mode` |

### Vulnerable Code (before fix)

**`src/configPersistence.ts`:**

```typescript
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true }); // ← No mode specified → 0755
}
const json = JSON.stringify(config, null, 2);
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, json, 'utf-8'); // ← No mode specified → 0644
```

**`src/layoutPersistence.ts`:**

```typescript
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true }); // ← No mode specified → 0755
}
const json = JSON.stringify(layout, null, 2);
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, json, 'utf-8'); // ← No mode specified → 0644
```

## Impact

- On shared systems with permissive `umask`, other local users could read config/layout files
- If sensitive data is ever added to config (e.g., API keys), it would be immediately exposed
- Inconsistent security posture vs. the hardened `server.ts`
- Violates principle of least privilege for file system access
- **SOC 2**: Weakens CC6.1 logical access controls and CC6.3 asset security

## Resolution Summary

Applied explicit restrictive permissions matching the pattern already used in `server/src/server.ts`:

**`src/configPersistence.ts`:**

```diff
- fs.mkdirSync(dir, { recursive: true });
+ fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const json = JSON.stringify(config, null, 2);
  const tmpPath = filePath + '.tmp';
- fs.writeFileSync(tmpPath, json, 'utf-8');
+ fs.writeFileSync(tmpPath, json, { encoding: 'utf-8', mode: 0o600 });
```

**`src/layoutPersistence.ts`:**

```diff
- fs.mkdirSync(dir, { recursive: true });
+ fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const json = JSON.stringify(layout, null, 2);
  const tmpPath = filePath + '.tmp';
- fs.writeFileSync(tmpPath, json, 'utf-8');
+ fs.writeFileSync(tmpPath, json, { encoding: 'utf-8', mode: 0o600 });
```

Result: Directory `~/.pixel-agents/` is created with `0700` (owner-only rwx), and all files are written with `0600` (owner-only rw), consistent with `server.json`.

## Acceptance Criteria

- [x] `src/configPersistence.ts` `mkdirSync` uses `mode: 0o700`
- [x] `src/configPersistence.ts` `writeFileSync` uses `mode: 0o600`
- [x] `src/layoutPersistence.ts` `mkdirSync` uses `mode: 0o700`
- [x] `src/layoutPersistence.ts` `writeFileSync` uses `mode: 0o600`
- [x] Permissions consistent with `server/src/server.ts`
- [x] All existing tests pass

## SOC 2 Mapping

| Control | Relevance                                                                          |
| ------- | ---------------------------------------------------------------------------------- |
| CC6.1   | Logical access controls must restrict unauthorized access to information assets    |
| CC6.3   | The entity implements controls to prevent unauthorized access to system components |

## References

- [CWE-732: Incorrect Permission Assignment for Critical Resource](https://cwe.mitre.org/data/definitions/732.html)
- [INFOSEC_ISSUES.md Issue 1](../INFOSEC_ISSUES.md)
- `server/src/server.ts` — reference implementation of correct permissions

---

**Labels**: `security`, `compliance`, `soc2`, `priority: high`, `file-permissions`
