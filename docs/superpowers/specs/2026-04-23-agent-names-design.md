# Design — Nomes dinâmicos para agentes

**Data:** 2026-04-23
**Branch:** feat/skill-visualization
**Status:** Rascunho aprovado pelo usuário, pendente implementação

## Contexto & motivação

Os personagens do escritório hoje são identificados apenas pelo número do terminal (Agent 1, Agent 2...). O usuário quer que cada personagem exiba um **nome curto que descreva a tarefa atual** (ex: `obsidian escritor`, `pixel-agents orquestrador`, `prime pesquisador`, `orquestrador marketing`). O nome deve aparecer como label flutuante acima do personagem e mudar quando a tarefa pivota significativamente.

## Decisões travadas (brainstorming)

| Item              | Escolha                                               | Resumo                                                  |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| 1. Fonte do nome  | Híbrido (heurística + LLM)                            | Heurística imediata, LLM refina depois                  |
| 2. Chamada do LLM | `claude -p` subprocess                                | Reusa auth existente, sem API key nova                  |
| 3. Cadência       | Inicial + transição + spawn                           | Heurística instantânea, LLM no 60s/5msg e em transições |
| 4. Formato        | 1-3 palavras, pt-BR, minúsculas, sem prefixo "agente" | `[contexto] [papel]` típico                             |
| 5. Visibilidade   | Sempre visível com fade 0.4/1.0                       | Destaca o focado                                        |
| 6. Sub-agentes    | Não renomear                                          | Mantém `Subtask:` atual                                 |
| 7. Persistência   | Não persiste                                          | Recomputa do zero ao recarregar                         |

## Arquitetura

```
JSONL transcript (source of truth)
        │
        ▼
┌─────────────────────────────────┐
│ Extension (src/)                │
│  ┌────────────────────────┐     │
│  │ agentNamer.ts (novo)   │     │
│  │  buildHeuristicName()  │     │
│  │  detectTransition()    │     │
│  │  refineViaClaude()     │     │
│  │  parseRefinedName()    │     │
│  └──────────┬─────────────┘     │
└─────────────┼───────────────────┘
              │ postMessage('agentNameUpdated', { id, name, source })
              ▼
┌─────────────────────────────────┐
│ Webview (React + canvas)        │
│  Character.name (novo)          │
│  labelRenderer.ts (novo)        │
└─────────────────────────────────┘
```

### Responsabilidades

- **Extension:** toda a inteligência (heurística, trigger, subprocess). Consome dados que já existem em `AgentState` (projectDir, tools, skill ativa); adiciona um histograma de tools leve.
- **Webview:** apenas rendering. Recebe o nome pronto e pinta o label.
- **Módulo isolado `src/agentNamer.ts`:** separa toda a lógica de nomeação do `transcriptParser.ts` e do `PixelAgentsViewProvider.ts`.

### Estado novo em `AgentState`

```ts
interface AgentState {
  // ... campos existentes
  /** Nome atual (heurístico ou refinado). null = ainda computando. */
  name: string | null;
  /** Snapshot dos sinais da última heurística, usado por detectTransition. */
  nameSignals: {
    cwdBase: string;
    lastSkill: string | null;
    toolHistogram: Record<string, number>;
    messageCountAtLastRefine: number;
    heuristicRole: string | null;
  } | null;
  /** Contador de tools usadas, janela deslizante de NAMER_TOOL_HISTOGRAM_WINDOW. */
  recentTools: string[];
  /** Timestamp do último refinamento LLM. */
  lastLlmRefineAt: number;
  /** Número de refinamentos LLM nesta sessão do agente. */
  llmRefineCount: number;
  /** LLM desabilitado pro resto da sessão após falha de subprocess. */
  llmRefineDisabled: boolean;
  /** Subprocess em voo — evita paralelismo. */
  llmRefineInFlight: boolean;
}
```

## Heurística

### CONTEXTO (1ª palavra) — prioridade decrescente

1. **Skill ativa** (último registro de Skill nos últimos 20 records): strip do prefixo plugin.
   - `superpowers:brainstorming` → `brainstorming`
   - `graphify` → `graphify`
2. **Subagent type** (se a última tool foi `Task` e é só `Task` no turno): mapeamento curto.
   - `general-purpose` → `pesquisa`
   - `Explore` → `explora`
3. **Workspace basename** normalizado (lowercase, preserva hífens e dígitos).
   - `pixel-agents` → `pixel-agents`
   - `PiMindIA` → `pimindia`
   - Path contendo `.claude` → `claude`

### PAPEL (2ª palavra) — histograma das últimas 30 tools

Ordem de teste (primeiro que bater):

1. `Task` count ≥ 2 → `orquestrador`
2. `Write + Edit + NotebookEdit` ≥ 50% das entradas → `escritor`
3. `Read + Grep + Glob + WebFetch + WebSearch` ≥ 50% → `pesquisador`
4. `Bash` ≥ 50% → `operador`
5. Nenhum bateu → sem papel (omite)

### Combinação

- Se contexto + papel existem → `[contexto] [papel]`
- Só contexto → `[contexto]`
- Só papel (raro, sem cwd/skill) → `[papel]`
- Nenhum → `null`

### Exemplos

| Situação            | Nome heurístico                      |
| ------------------- | ------------------------------------ |
| Vault com 10 edits  | `pimindia escritor`                  |
| `/graphify` rodando | `graphify pesquisador` ou `graphify` |
| 3 Tasks seguidas    | `pixel-agents orquestrador`          |
| 20 Greps            | `pixel-agents pesquisador`           |
| 10 Bashes           | `pixel-agents operador`              |
| Recém-criado        | `pixel-agents`                       |

## Refinamento via LLM (`claude -p`)

### Disparos

1. **Inicial:** 5 mensagens OU 60s de vida do agente (o que vier primeiro).
2. **Transição detectada pelo `detectTransition()`:**
   - `nameSignals.lastSkill` mudou
   - `nameSignals.heuristicRole` mudou
   - Novo prompt do usuário com delta de histograma > 30% vs `messageCountAtLastRefine`
3. **Throttle:** mínimo 90s entre dois refinamentos do mesmo agente.
4. **Budget:** máximo 20 refinamentos por sessão de agente.
5. **Concorrência:** 1 subprocess em voo por agente (`llmRefineInFlight`).

### Prompt enviado ao `claude -p`

```
Você está nomeando um agente de IA de programação com base no que ele está
fazendo agora.

WORKSPACE: <cwd>
NOME HEURÍSTICO (fallback): <heuristicName>
ATIVIDADE RECENTE (últimas 15 mensagens usuário+assistente, resumidas):
<bullets extraídos do transcript, cada um ≤ 200 chars>
TOOLS RECENTES: <histograma>
SKILL ATIVA: <skillName ou "nenhuma">

Produza um nome curto em pt-BR com 1-3 palavras em minúsculas, sem prefixo
"agente", sem pontuação. Formato: [contexto] [papel], ou só [contexto], ou
só [papel]. Prefira palavras concretas do domínio sobre genéricas (ex:
"obsidian" em vez de "vault", "marketing" em vez de "conteudo"). Use
"escritor" / "pesquisador" / "orquestrador" / "operador" para papéis. Se
estiver em dúvida, retorne o nome heurístico literalmente.

Responda APENAS com o nome, nada mais.
```

### Invocação

```ts
import { spawn } from 'child_process';

const child = spawn('claude', ['-p', prompt, '--output-format', 'text'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: NAMER_CLAUDE_TIMEOUT_MS, // 30_000
});
```

### Validação da resposta (`parseRefinedName`)

- Trim whitespace
- Regex: `/^[a-z0-9à-ÿ\- ]{1,30}$/`
- Contagem de palavras: 1 a 3
- Falhou validação → retorna `null` (mantém nome heurístico sem flag de erro)

### Erros

- Subprocess falhou (`exit ≠ 0`, timeout, `claude` binário ausente): log warning, setta `llmRefineDisabled = true` por toda a sessão do agente, mantém heurística.
- Nome inválido: só descarta, não desabilita.

## Transporte

### Nova mensagem (extension → webview)

```ts
{
  type: 'agentNameUpdated',
  id: number,
  name: string,
  source: 'heuristic' | 'llm',
}
```

Disparada toda vez que `name` muda. `source` é informativo (pode ser usado no futuro pra animar transições diferentes).

### Handler no webview

`useExtensionMessages.ts` mantém `agentNames: Map<number, string>` em React state, passado via prop pro `OfficeCanvas`, que propaga pro `officeState` que seta `ch.name` no `Character` correspondente.

## Renderização

### Campo novo em `Character`

```ts
interface Character {
  // ... existentes
  name: string | null;
}
```

### Função nova `renderCharacterLabels()` em `labelRenderer.ts`

Chamada depois dos personagens, antes das bubbles no loop de render.

- **Posição:** x = centro do personagem, y = topo da cabeça - 4px. Se bubble ativa, sobe +14px (aparece acima da bubble).
- **Fonte:** FS Pixel Sans, tamanho `8 * zoom` px.
- **Cor:** texto `#ffffff`, outline `#0a0a14` de 1px em 4 direções (shadow offset 1px em N/S/L/O).
- **Opacidade:**
  - `1.0` se `cameraFollowId === ch.id` OU `selectedAgentId === ch.id` OU `hoveredAgentId === ch.id`
  - `0.4` caso contrário
  - `0` (skip) se `ch.name === null`
- **Z-order:** camada separada depois dos personagens e antes das bubbles; labels sempre por cima de personagens, mas bubbles ficam por cima de labels.
- **Overflow:** `name.length > 20` → trunca em 19 chars + `…`.
- **Despawn effect:** labels de `matrixEffect !== null` não são renderizados.
- **Sub-agentes:** `ch.name` é sempre `null` → não renderizam label.

### Collision handling

Não resolvemos colisão entre labels próximos em v1. Fade já reduz o impacto; dois personagens grudados com labels longos é caso raro.

## Arquivos

### Novos

- `src/agentNamer.ts` — toda a lógica (heurística + trigger + subprocess + parser)
- `server/__tests__/agentNamer.test.ts` — testes unitários (reusa padrão atual de `../src/...`)
- `webview-ui/src/office/engine/labelRenderer.ts` — `renderCharacterLabels()`

### Modificados

- `src/types.ts` — novos campos em `AgentState`
- `src/PixelAgentsViewProvider.ts` — init do namer, tick de refinamento, cleanup de timers
- `src/transcriptParser.ts` — hooks que alimentam `recentTools` e chamam `maybeRenameAgent()` após cada tool_use / user prompt
- `src/constants.ts` — novas constantes
- `server/tsconfig.test.json` — incluir `../src/agentNamer.ts`
- `webview-ui/src/hooks/useExtensionMessages.ts` — case `agentNameUpdated`
- `webview-ui/src/office/types.ts` — `Character.name`
- `webview-ui/src/office/engine/characters.ts` — `createCharacter` aceita e zera `name`
- `webview-ui/src/office/engine/officeState.ts` — handler que seta `ch.name` do message
- `webview-ui/src/office/engine/renderer.ts` — chama `renderCharacterLabels()`
- `webview-ui/src/constants.ts` — novas constantes de label

### Constantes

**`src/constants.ts`:**

- `NAMER_INITIAL_REFINE_DELAY_MS = 60_000`
- `NAMER_INITIAL_REFINE_MSG_THRESHOLD = 5`
- `NAMER_THROTTLE_MS = 90_000`
- `NAMER_MAX_REFINES_PER_SESSION = 20`
- `NAMER_CLAUDE_TIMEOUT_MS = 30_000`
- `NAMER_TOOL_HISTOGRAM_WINDOW = 30`
- `NAMER_TRANSITION_HISTOGRAM_DELTA = 0.3`

**`webview-ui/src/constants.ts`:**

- `LABEL_FONT_PX_BASE = 8`
- `LABEL_FADE_OPACITY = 0.4`
- `LABEL_FOCUSED_OPACITY = 1.0`
- `LABEL_MAX_CHARS = 20`
- `LABEL_Y_OFFSET_PX = 4`
- `LABEL_Y_OFFSET_WITH_BUBBLE_PX = 18`
- `LABEL_OUTLINE_COLOR = '#0a0a14'`
- `LABEL_TEXT_COLOR = '#ffffff'`

## Testes

### `server/__tests__/agentNamer.test.ts`

**`buildHeuristicName()`:**

- Sem sinais → `null`
- Só workspace → nome só com contexto
- Workspace + Write/Edit dominante → `[contexto] escritor`
- Workspace + Read/Grep dominante → `[contexto] pesquisador`
- Workspace + Task count ≥ 2 → `[contexto] orquestrador`
- Workspace + Bash dominante → `[contexto] operador`
- Skill ativa sobrescreve workspace como contexto
- Strip de prefixo `superpowers:` → usa segundo segmento
- PascalCase e hífens de pasta normalizados
- Path contendo `.claude` → `claude`

**`detectTransition()`:**

- Primeira chamada sem snapshot → `true`
- Sem mudança → `false`
- Skill mudou → `true`
- Papel heurístico mudou → `true`
- Delta de histograma > 30% → `true`
- Throttle: < 90s desde último → `false` mesmo com mudança

**`parseRefinedName()`:**

- Nome válido 2 palavras → aceita
- Nome válido 1 palavra → aceita
- Nome válido 3 palavras → aceita
- 4 palavras → `null`
- Caracteres proibidos (pontuação, maiúsculas) → `null`
- String vazia / whitespace → `null`
- Com espaços extras / trailing newline → trimado e aceito

**Não testado:** subprocess real de `claude -p` (flakiness, dependência externa).

## Edge cases

1. **Agent sem workspace/seat no spawn** → `name: null`, label só aparece quando primeiro sinal chega.
2. **`/clear` no meio da sessão** → reset: zera `nameSignals`, `llmRefineCount`, mantém nome atual visualmente até recompute.
3. **Subprocess `claude` indisponível** → primeiro erro desabilita LLM pra sessão, log warning, heurística continua.
4. **Nome retornado em inglês apesar do prompt** → aceita se passa no regex. Não forçamos detecção de idioma.
5. **Sub-agentes (ID < 0)** → `agentNamer` pula completamente. `Character.name` permanece `null`.
6. **Restore de agente persistido** → `name: null` inicial (não persistimos), refaz o ciclo.
7. **Agente vive < 60s** → nunca chega a refinar via LLM, fica só com heurística. OK.

## Fora de escopo (v1)

- Toggle nas Settings pra ligar/desligar
- Override manual (pinned name) por agente
- Persistência cross-reload
- Renomeação de sub-agentes
- Collision resolution entre labels sobrepostos
- Configuração do prompt/limites pelo usuário
- Animação de transição entre nomes (fade/morph)

## Riscos

- **Subprocess `claude` lento pode acumular** se vários agentes pivotarem simultaneamente. Mitigação: `llmRefineInFlight` por agente + spawn independente por agente (não serializamos globalmente pra não travar).
- **Transcripts gigantes** podem ficar caros de ler pra montar o contexto do prompt. Mitigação: só lemos as últimas ~15 mensagens via `tail` lógico de offsets.
- **Nome ruim do LLM** (ex: ignora instruções, volta com explicação) → `parseRefinedName` descarta e mantém heurística. Usuário nunca vê lixo.
