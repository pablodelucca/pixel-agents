# Follow-up: Tests for `maybeRefineTaskLabel` orchestrator

**Origem**: review pós-Phase 2 (`feat/skill-visualization`, 2026-05-02). Code-reviewer flagou Important #5 — zero cobertura no orquestrador async mais complexo do feature.

**Status**: ✅ concluído em 2026-05-02. `refineFn` injetável + 12 testes novos cobrindo as 11 branches. `npm test`: 195/195 passando.

## Contexto

`src/agentNamer.ts:265` (`maybeRefineTaskLabel`) tem lógica não-trivial:

- Guarda contra reentrada (`llmRefineInFlight`)
- Budget máximo por sessão (`NAMER_MAX_REFINES_PER_SESSION`)
- Eligibilidade inicial (idade OU `messageCount`)
- Gate de transição (`detectTransition`)
- Mutação de estado em sucesso/falha
- Retry/backoff com `llmRefineConsecutiveFailures` (3 falhas consecutivas → disable)

Plan original (`2026-04-23-agent-names.md`, Task 9 step 5) sancionou ausência de testes ("manual verification via Task 12"). Mas complexidade async + side effects merece suíte vitest.

## Tarefas

### 1. Tornar `refineViaClaude` injetável

Refatorar a assinatura de `maybeRefineTaskLabel` para aceitar `refineFn`:

```ts
export async function maybeRefineTaskLabel(
  agent: AgentState,
  webview: vscode.Webview | undefined,
  readRecentBullets: (agent: AgentState) => Promise<string[]>,
  now: number = Date.now(),
  refineFn: (prompt: string) => Promise<string | null> = refineViaClaude,
): Promise<void> { ... }
```

Default continua `refineViaClaude` — sem mudança de comportamento em produção.

### 2. Suíte em `server/__tests__/agentNamer.test.ts`

Cobrir branches:

- **sub-agent skip** (`agent.id < 0`) — `refineFn` não é chamado
- **`llmRefineDisabled === true`** — early return, `refineFn` não chamado
- **`llmRefineInFlight === true`** — early return
- **budget excedido** (`llmRefineCount >= NAMER_MAX_REFINES_PER_SESSION`) — early return
- **inelegível** (idade < threshold E `messageCount` < threshold) — early return
- **sem transição** (`detectTransition` retorna false) — early return
- **sucesso**: muta `taskLabel`, posta `agentLabelUpdated` com `source: 'llm'`, reseta `llmRefineConsecutiveFailures` para 0
- **falha (refined === null)**: incrementa `llmRefineConsecutiveFailures`, NÃO seta `llmRefineDisabled` ainda (1ª/2ª falha)
- **3ª falha consecutiva**: seta `llmRefineDisabled = true`, log warning
- **sucesso após falhas**: reseta contador para 0
- **heuristic vazio**: retorna sem chamar `refineFn`

`refineFn` mockado com `vi.fn()`. `webview` com `postMessage: vi.fn()`. `readRecentBullets` retorna array fixo.

### 3. Aceitação

- `npm run build` limpo
- `npm test` passando
- Cobertura ≥ 80% das branches listadas

## Não fazer

- Não testar `refineViaClaude` em si (subprocess real) — ele é trivial e seria flaky.
- Não mudar a API pública de outros chamadores (apenas adicionar parâmetro opcional ao final).
