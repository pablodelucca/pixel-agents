# Security Issue: SEC-006 - Unencrypted Local Transport (No TLS)

## Finding Details

| Field          | Value                          |
| -------------- | ------------------------------ |
| **Finding ID** | SEC-006                        |
| **Severity**   | Medium                         |
| **CVSS Score** | 5.3 (estimated)                |
| **Category**   | Transport Security             |
| **Status**     | Resolved                       |
| **Priority**   | P2 - Short-term (within 30 days) |
| **SOC 2 Controls** | CC6.7 (Data Transmission Security) |

## Description

The internal HTTP server communicated over plain HTTP (unencrypted). The bearer auth
token was transmitted in the `Authorization` header on every hook event request. While
the server was bound exclusively to `127.0.0.1`, the token was visible to:

1. Local packet capture tools (e.g., Wireshark, tcpdump on the loopback interface)
2. Other processes using raw sockets
3. System-level security monitoring tools that capture loopback traffic

This means the bearer token — which grants access to the hook event API — could be
intercepted by any local packet capture without requiring the attacker to read the
filesystem (where the token is stored at `~/.pixel-agents/server.json` with `0o600`
permissions).

## Affected Files (before fix)

- **`server/src/server.ts`** — `http.createServer()` / `server.listen(0, '127.0.0.1')`
- **`server/src/providers/hook/claude/hooks/claude-hook.ts`** — `http.request({ hostname: '127.0.0.1', port })`

## Mitigating Factors (pre-fix)

- Localhost-only binding (`127.0.0.1`) prevented remote interception ✅
- Auth token regenerated on every server start (not persistent across sessions) ✅
- Auth token stored at `~/.pixel-agents/server.json` with `0o600` permissions ✅
- Random port assignment made endpoint discovery harder ✅

## Resolution

Migrated from TCP (localhost `127.0.0.1`) to **Unix domain sockets**. This eliminates
network-layer interception entirely:

- No loopback traffic to capture — communication happens entirely in kernel memory
- Socket file created at `<tmpdir>/pixel-agents-<pid>-<random>.sock` with `0o600`
  permissions (owner-only read/write)
- Filesystem ACLs replace network-layer auth — only the owning user can connect
- Bearer token retained as defense-in-depth (still validates that the connecting
  process could read `server.json`)

### Key Code Changes

```typescript
// server/src/server.ts — now listens on a Unix socket
const socketPath = getSocketPath(); // e.g. /tmp/pixel-agents-12345-a1b2c3d4.sock
this.server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o600); // owner-only access
  this.config = { socketPath, pid: process.pid, token, startedAt };
  this.writeServerJson(this.config);
  resolve(this.config);
});

// ServerConfig interface updated:
interface ServerConfig {
  socketPath: string; // replaces port
  pid: number;
  token: string;      // retained for defense-in-depth
  startedAt: number;
}
```

```typescript
// server/src/providers/hook/claude/hooks/claude-hook.ts — connects via socket
const req = http.request(
  {
    socketPath: server.socketPath, // replaces hostname + port
    path: `${HOOK_API_PREFIX}/claude`,
    method: 'POST',
    headers: { Authorization: `Bearer ${server.token}` },
    timeout: 2000,
  },
  () => resolve(),
);
```

### Windows Compatibility

On Windows 10 1903+ (which supports AF_UNIX), the same `socketPath` format works.
On older Windows, `getSocketPath()` generates a named pipe path
(`\\.\pipe\pixel-agents-<pid>-<suffix>`) which Node.js handles natively.

### Socket Cleanup

- **On start**: removes any stale socket file from a crashed previous process
- **On stop**: removes the socket file (only if `ownsServer`)
- **Permissions**: `fs.chmodSync(socketPath, 0o600)` applied immediately after listen

## Acceptance Criteria

- [x] Server no longer listens on TCP port
- [x] Server listens on Unix domain socket with `0o600` permissions
- [x] `ServerConfig.socketPath` replaces `ServerConfig.port`
- [x] `server.json` written with `socketPath` instead of `port`
- [x] Hook script connects via `socketPath` (no hostname/port)
- [x] Bearer token retained as defense-in-depth
- [x] Socket file cleaned up on server stop
- [x] Stale socket file removed on server start
- [x] All server tests updated and passing
- [x] Multi-window reuse still works (second instance reads `socketPath` from `server.json`)
- [x] Windows named pipe support via `getSocketPath()` platform detection

## SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC6.7 | Data in transit must be protected; Unix socket eliminates network-layer exposure |

## References

- [INFOSEC_ISSUES.md Issue 6](../INFOSEC_ISSUES.md)
- [Node.js Unix Domain Sockets](https://nodejs.org/api/net.html#serverlistenpath-backlog-callback)
- [CWE-319: Cleartext Transmission of Sensitive Information](https://cwe.mitre.org/data/definitions/319.html)

---

**Labels**: `security`, `compliance`, `soc2`
