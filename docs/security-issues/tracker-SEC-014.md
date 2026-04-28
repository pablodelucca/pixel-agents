# Issue Tracker: SEC-014 — Symlink Attack Surface on File Watchers

| Field                   | Value                                           |
| ----------------------- | ----------------------------------------------- |
| **Finding ID**          | SEC-014                                         |
| **Severity**            | Low                                             |
| **CVSS Score**          | 2.5 (estimated)                                 |
| **Category**            | Path Traversal / Symlink                        |
| **Status**              | ✅ Resolved                                     |
| **Priority**            | P4 — Backlog                                    |
| **SOC 2 Controls**      | CC6.1, CC6.6                                    |
| **Consolidated Report** | [SECURITY_FINDINGS.md](../SECURITY_FINDINGS.md) |

## Description

The extension reads files from user-writable directories (`~/.pixel-agents/`,
`~/.claude/projects/`, user-configured external asset directories) using `fs.readFileSync`
and `fs.existsSync` without checking whether the target is a symbolic link. An attacker with
local file system access could create symlinks pointing to sensitive system files, potentially
causing the extension to read and process unintended file content.

## Affected Files

| File                       | Function                | Risk                                                                |
| -------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `src/layoutPersistence.ts` | `readLayoutFromFile()`  | Reads `~/.pixel-agents/layout.json` without symlink check           |
| `src/configPersistence.ts` | `readConfig()`          | Reads `~/.pixel-agents/config.json` without symlink check           |
| `src/fileWatcher.ts`       | `readNewLines()`        | Reads JSONL session files without symlink check                     |
| `src/assetLoader.ts`       | Asset loading functions | Has path traversal protection but `path.resolve()` follows symlinks |

## Risk Assessment

### Impact

- **Confidentiality:** Low — extension doesn't transmit file contents externally
- **Integrity:** Low — parsed content is used only for local UI rendering
- **Availability:** Low — symlink to large file could cause excessive memory usage

### Likelihood

- **Exploitability:** Very Low — requires local file system access on the same machine
- **Attack Vector:** Local only — attacker must be on the same multi-user system

### Mitigating Factors

- ✅ Extension does not transmit file contents to any external service
- ✅ File contents are parsed as JSON/JSONL; invalid data is rejected by Zod schemas (SEC-001)
- ✅ Asset loader has path traversal protection (`startsWith(resolvedDir)`)
- ✅ JSONL line length limits prevent memory exhaustion (SEC-011)
- ✅ All operations are local to the user's filesystem

### Overall Risk

Low — the combination of local-only access requirement, JSON schema validation rejecting
non-conforming data, and no external data transmission makes exploitation very limited in
practical impact.

## Recommended Remediation

Add `fs.lstatSync()` symlink validation before security-sensitive file reads:

```typescript
import * as fs from 'fs';

function isSymlink(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

// Before reading security-sensitive files:
if (isSymlink(filePath)) {
  logger.warn(`Refusing to read symlinked file: ${filePath}`);
  return null;
}
```

Apply this check in:

1. `src/layoutPersistence.ts` — `readLayoutFromFile()`
2. `src/configPersistence.ts` — `readConfig()`
3. `src/fileWatcher.ts` — before reading JSONL files
4. `src/assetLoader.ts` — additionally to the existing path containment check

## Acceptance Criteria

- [x] `isSymlink()` helper function created in `src/symlinkCheck.ts`
- [x] `layoutPersistence.ts` validates symlinks before reading layout file
- [x] `configPersistence.ts` validates symlinks before reading config file
- [x] `fileWatcher.ts` validates symlinks before reading JSONL files
- [x] `assetLoader.ts` validates symlinks in addition to existing path traversal checks (manifest + PNG reads in `loadFurnitureAssets`, character reads in `loadExternalCharacterSprites`)
- [x] Warning logged when symlink is detected and rejected (SEC-014 prefix)
- [x] Unit tests for symlink detection (`server/__tests__/symlinkCheck.test.ts`, 7 tests)
- [x] No regression in normal file operations (194/194 tests pass)
- [x] Documentation updated in `docs/SECURITY_FINDINGS.md`

## SOC 2 Mapping

| Control | Relevance                                                         |
| ------- | ----------------------------------------------------------------- |
| CC6.1   | File access should be validated to prevent unintended data access |
| CC6.6   | Symlink attacks are a known OS-level threat vector                |

## References

- [CWE-59: Improper Link Resolution Before File Access](https://cwe.mitre.org/data/definitions/59.html)
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)

---

**Labels:** `security`, `compliance`, `defense-in-depth`, `P4`
