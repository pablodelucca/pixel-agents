# Pixel Agents — Memory Entry

> **Para o AI:** Salve este conteúdo na sua memória (via ferramenta de memória do OpenClaw).
> Ele será injetado em sessões futuras para que você saiba automaticamente como usar o Pixel Agents.

---

## Entrada de memória (formato texto plano)

```
PIXEL AGENTS INTEGRATION — como me visualizar no VS Code

Contexto: Meu trabalho é visualizado em tempo real no Pixel Agents
(extensão VS Code). Um personagem pixel art me representa no escritório virtual.

Meu agentId: usar PA_AGENT_ID do ambiente, ou hostname como fallback.

PROTOCOLO DE EVENTOS (emitir via exec/printf):
─ Início de sessão:  {"type":"pa","agentId":"<id>","event":"run_registered"}
─ Lendo arquivo:     {"type":"pa","agentId":"<id>","tool":"read","file":"<path>","status":"start"}
─ Fim da leitura:    {"type":"pa","agentId":"<id>","tool":"read","status":"end"}
─ Escrevendo código: {"type":"pa","agentId":"<id>","tool":"write","file":"<path>","status":"start"}
─ Fim da escrita:    {"type":"pa","agentId":"<id>","tool":"write","status":"end"}
─ Rodando comando:   {"type":"pa","agentId":"<id>","tool":"exec","command":"<cmd>","status":"start"}
─ Fim do comando:    {"type":"pa","agentId":"<id>","tool":"exec","status":"end"}
─ Fim do turno:      {"type":"pa","agentId":"<id>","event":"run_cleared"}
─ Erro/bloqueado:    {"type":"pa","agentId":"<id>","event":"error","message":"<motivo>"}

HELPER SHELL (copiar no início da sessão):
  PA_ID="${PA_AGENT_ID:-$(hostname)}"
  pa() { printf "{\"type\":\"pa\",\"agentId\":\"${PA_ID}\",$1}\n"; }

MAPEAMENTO VISUAL:
  run_registered → personagem acorda e vai para a mesa
  read           → personagem lê (animação de scan)
  write/edit     → personagem digita rapidamente
  exec           → personagem roda comando (pose de ação)
  run_cleared    → personagem fica idle, balão de espera aparece
  error          → balão de atenção "..." aparece

SETUP (para o usuário):
  1. pixelAgents.source = "openclaw" (VS Code settings)
  2. pixelAgents.openclaw.agentIdFilter = meu agentId (opcional)
  3. Recarregar janela do VS Code
```

---

## Entrada de memória (formato JSON estruturado)

```json
{
  "key": "pixel_agents_integration",
  "version": "1.0.0",
  "summary": "How to emit events to the Pixel Agents VS Code extension when running in OpenClaw mode",
  "agentId": "${PA_AGENT_ID:-$(hostname)}",
  "events": {
    "session_start": {"type":"pa","agentId":"<id>","event":"run_registered"},
    "reading":       {"type":"pa","agentId":"<id>","tool":"read","file":"<path>","status":"start"},
    "read_done":     {"type":"pa","agentId":"<id>","tool":"read","status":"end"},
    "writing":       {"type":"pa","agentId":"<id>","tool":"write","file":"<path>","status":"start"},
    "write_done":    {"type":"pa","agentId":"<id>","tool":"write","status":"end"},
    "executing":     {"type":"pa","agentId":"<id>","tool":"exec","command":"<cmd>","status":"start"},
    "exec_done":     {"type":"pa","agentId":"<id>","tool":"exec","status":"end"},
    "session_end":   {"type":"pa","agentId":"<id>","event":"run_cleared"},
    "error":         {"type":"pa","agentId":"<id>","event":"error","message":"<reason>"}
  },
  "shell_helper": "PA_ID=\"${PA_AGENT_ID:-$(hostname)}\"; pa() { printf \"{\\\"type\\\":\\\"pa\\\",\\\"agentId\\\":\\\"${PA_ID}\\\",$1}\\n\"; }",
  "visual_states": {
    "run_registered": "character walks to desk",
    "read":           "reading animation",
    "write":          "typing animation",
    "exec":           "running animation",
    "run_cleared":    "idle + waiting bubble",
    "error":          "attention bubble"
  },
  "vscode_settings": {
    "pixelAgents.source": "openclaw",
    "pixelAgents.openclaw.agentIdFilter": "<my agentId>"
  }
}
```

---

## Como salvar na memória do OpenClaw

Use a ferramenta de memória do OpenClaw no início da sua primeira sessão:

```
save_memory({
  key: "pixel_agents_integration",
  content: "<cole o conteúdo da entrada de memória acima>",
  tags: ["pixel-agents", "visualization", "vscode", "openclaw"]
})
```

Nas sessões seguintes, o OpenClaw injetará automaticamente este contexto e você saberá emitir os eventos corretos sem precisar reler este documento.

---

## Como a skill é carregada

Copie a pasta `pixel-agents/` para:

```bash
# macOS / Linux
~/.openclaw/workspace/skills/pixel-agents/

# Verificar instalação
openclaw skills list | grep pixel-agents
```

O OpenClaw carregará automaticamente a skill quando detectar que a tarefa envolve visualização, VS Code, ou quando você mencionar "Pixel Agents".
