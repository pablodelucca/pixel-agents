# Security Issue: SEC-001 - JSON Parsing Without Schema Validation

## Finding Details

| Field | Value |
|-------|-------|
| **Finding ID** | SEC-001 |
| **Severity** | Medium |
| **CVSS Score** | 5.5 (estimated) |
| **Category** | Input Validation |
| **Status** | Open |
| **Priority** | P1 - Immediate (within 7 days) |

## Description

JSON data from external sources (JSONL transcript files, imported layouts, configuration files) is parsed using `JSON.parse()` without runtime schema validation. While TypeScript provides compile-time type safety, runtime data from external sources is not validated against a schema before being processed.

This creates a risk where malformed or malicious JSON from Claude Code transcripts, imported layouts, or configuration files could cause unexpected behavior, crashes, or potentially security issues through prototype pollution or property injection.

## Affected Files

- `src/transcriptParser.ts:102` - JSONL transcript parsing
- `src/layoutPersistence.ts:28` - Layout file parsing  
- `src/configPersistence.ts:24` - Config file parsing
- `src/PixelAgentsViewProvider.ts:779` - Import layout parsing

### Code Examples

**Current Implementation (No Validation):**
```typescript
// src/transcriptParser.ts:102
const record = JSON.parse(line);

// src/layoutPersistence.ts:28
return JSON.parse(raw) as Record<string, unknown>;

// src/configPersistence.ts:24
const parsed = JSON.parse(raw) as Partial<PixelAgentsConfig>;
```

## Risk Assessment

### Impact
- **Confidentiality**: Low - No direct data exposure
- **Integrity**: Medium - Malformed data could corrupt application state
- **Availability**: Medium - Malformed JSON could crash the extension

### Likelihood
- **Exploitability**: Low - Requires control of local files or Claude Code output
- **Attack Vector**: Local - Attacker needs local file system access

### Overall Risk
Medium - While exploitation requires local access, the lack of validation is a defense-in-depth gap that should be addressed for enterprise compliance.

## Remediation Steps

### Option 1: Implement Zod Schema Validation (Recommended)

1. **Add Zod dependency**
   ```bash
   npm install zod
   ```

2. **Create schema definitions**
   ```typescript
   // src/schemas/transcript.ts
   import { z } from 'zod';
   
   export const TranscriptRecordSchema = z.object({
     type: z.enum(['assistant', 'user', 'system', 'progress', 'queue-operation']),
     message: z.object({
       content: z.union([z.string(), z.array(z.unknown())]).optional(),
       usage: z.object({
         input_tokens: z.number().optional(),
         output_tokens: z.number().optional(),
       }).optional(),
     }).optional(),
     content: z.union([z.string(), z.array(z.unknown())]).optional(),
     subtype: z.string().optional(),
     // ... additional fields
   }).passthrough();
   
   export type TranscriptRecord = z.infer<typeof TranscriptRecordSchema>;
   ```

3. **Create layout schema**
   ```typescript
   // src/schemas/layout.ts
   import { z } from 'zod';
   
   export const LayoutSchema = z.object({
     version: z.literal(1),
     cols: z.number().int().positive(),
     rows: z.number().int().positive(),
     tiles: z.array(z.number()),
     furniture: z.array(z.object({
       uid: z.string(),
       type: z.string(),
       row: z.number().int(),
       col: z.number().int(),
       color: z.object({
         h: z.number(),
         s: z.number(),
         b: z.number(),
         c: z.number(),
         colorize: z.boolean().optional(),
       }).optional(),
     })),
     tileColors: z.array(z.unknown()).optional(),
   });
   
   export type Layout = z.infer<typeof LayoutSchema>;
   ```

4. **Update parsing code**
   ```typescript
   // src/transcriptParser.ts
   import { TranscriptRecordSchema } from './schemas/transcript';
   
   export function processTranscriptLine(...) {
     try {
       const parsed = JSON.parse(line);
       const record = TranscriptRecordSchema.safeParse(parsed);
       
       if (!record.success) {
         console.warn(`Invalid transcript record: ${record.error.message}`);
         return;
       }
       
       // Use record.data safely
     } catch (e) {
       console.error(`Failed to parse transcript line: ${e}`);
     }
   }
   ```

### Option 2: Manual Validation with Type Guards

```typescript
function isValidTranscriptRecord(data: unknown): data is TranscriptRecord {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  
  if (!['assistant', 'user', 'system', 'progress'].includes(record.type as string)) {
    return false;
  }
  
  // Additional validation...
  return true;
}
```

## Acceptance Criteria

- [ ] Schema validation library (Zod) is added to dependencies
- [ ] Schemas are defined for all parsed JSON structures:
  - [ ] Transcript records (JSONL)
  - [ ] Layout files
  - [ ] Configuration files
  - [ ] Imported layouts
- [ ] All `JSON.parse()` calls are wrapped with schema validation
- [ ] Invalid data is handled gracefully (logged, not crashed)
- [ ] Unit tests cover:
  - [ ] Valid data passes validation
  - [ ] Malformed data is rejected
  - [ ] Missing required fields are rejected
  - [ ] Unknown fields are handled appropriately (passthrough or reject)
- [ ] No regression in existing functionality
- [ ] Documentation updated in `docs/SECURITY_ANALYSIS.md` to mark as resolved

## Testing Requirements

1. **Unit Tests**
   - Test each schema with valid data
   - Test each schema with invalid data types
   - Test with missing required fields
   - Test with extra/unknown fields
   - Test with nested object validation

2. **Integration Tests**
   - Import a malformed layout file and verify graceful handling
   - Process malformed JSONL and verify extension stability

3. **Fuzz Testing (Optional)**
   - Consider fuzzing JSON parsers with random input

## References

- [Zod Documentation](https://zod.dev/)
- [OWASP Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html)

---

**Labels**: `security`, `compliance`, `priority: high`
