# Issue Tracker: SEC-015 — Security Policy References Upstream Repository

| Field | Value |
|-------|-------|
| **Finding ID** | SEC-015 |
| **Severity** | Informational |
| **Category** | Documentation / Configuration |
| **Status** | ⚠️ Open |
| **Priority** | P4 — Backlog |
| **SOC 2 Controls** | CC1.4 |
| **Consolidated Report** | [SECURITY_FINDINGS.md](../SECURITY_FINDINGS.md) |

## Description

The `SECURITY.md` file at the repository root references the upstream repository
(`pablodelucca/pixel-agents`) for vulnerability reporting, not this fork
(`scwardbulldog/sw-pixel-agents`). For enterprise deployment and SOC 2 compliance,
the security policy must direct vulnerability reports to the correct organization.

## Affected Files

| File | Line | Current Value |
|------|------|---------------|
| `SECURITY.md` | 11 | `https://github.com/pablodelucca/pixel-agents/security/advisories/new` |

### Current Content

```markdown
Please report security vulnerabilities through [GitHub's private vulnerability reporting](https://github.com/pablodelucca/pixel-agents/security/advisories/new).
```

### Expected Content

```markdown
Please report security vulnerabilities through [GitHub's private vulnerability reporting](https://github.com/scwardbulldog/sw-pixel-agents/security/advisories/new).
```

## Risk Assessment

### Impact
- **Confidentiality:** None — no technical vulnerability
- **Integrity:** Low — vulnerability reports sent to wrong team
- **Availability:** None

### Likelihood
- **Exploitability:** N/A — documentation issue, not a technical vulnerability
- **Attack Vector:** N/A

### Overall Risk
Informational — this is a compliance documentation issue. Vulnerability reports submitted
to the upstream repository would not reach the maintainers of this fork.

## Recommended Remediation

1. Update `SECURITY.md` line 11 to reference `scwardbulldog/sw-pixel-agents`
2. Consider adding:
   - Internal security team contact information
   - Escalation procedures for this organization
   - SLA expectations aligned with enterprise policy
   - Scope clarification for the fork vs. upstream

## Acceptance Criteria

- [ ] `SECURITY.md` vulnerability reporting URL references `scwardbulldog/sw-pixel-agents`
- [ ] Scope section updated if needed for fork-specific context
- [ ] Documentation updated in `docs/SECURITY_FINDINGS.md`

## SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC1.4 | Security incident reporting must be directed to the responsible organization |

## References

- [GitHub Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
- [SOC 2 CC1.4](https://us.aicpa.org/interestareas/frc/assuranceadvisoryservices/sorhome)

---

**Labels:** `security`, `compliance`, `documentation`, `P4`
