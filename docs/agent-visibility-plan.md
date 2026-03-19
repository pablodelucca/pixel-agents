# 에이전트 활동 관찰성 강화 계획

**목표**: README의 `deep inspection`/`token health` 비전처럼, 각 에이전트가 무엇을 왜 하고 있는지 (무엇을 만지고, 누구가 시작했고, 어떤 도구를 사용하는지, 얼마나 자신 있는지, 얼마나 오래 걸렸는지)를 실시간으로 보여주는 명확한 관찰 모델을 만들고, 그 기준에 맞춰 실제 UI와 상태 추적을 개선한다.

## 배경
- `src/transcriptParser.ts`는 툴 이용을 문자열 상태로 축약해 전달하며, 안전 관련 정보(`agentStatus`, `agentToolPermission`)도 heuristic 타이머(5초 idle, 7초 permission)에 의존한다.
- `TimerManager` 흐름과 `useExtensionMessages`/`ToolOverlay`/`DebugView`는 상태/이벤트를 오래 유지하지 못해, 사용자에게 에이전트의 활동 내역을 설명하거나 우선순위를 알려주기 어렵다.
- `App.tsx`의 클릭은 터미널 포커스 전용이라, “상세 Inspector”가 없는 현재 구조로는 Agent를 깊이 들여다보기 어려움.

## 정의된 기준 (Definition of Done)
1. `ToolActivity` 객체는 `toolName`, `statusText`, `target`, `command`, `startTime`, `duration`, `confidence`, `parentToolId`, `source`, `permissionState` 같은 필드를 담는다.
2. 파서/타이머/agent state가 문자열이 아닌 객체를 emit하며 `webview-ui/src/hooks/useExtensionMessages.ts`가 이 구조를 받아서 `agentTools`와 `subagentTools`를 업데이트한다.
3. 메인 캔버스의 클릭은 “Inspector 열기”로 변경되고, `ToolOverlay`는 그 Inspector를 표현하며 현재 작업, last tool history timeline, Permission/Waiting badge, subagent 트리, confidence 정보를 표시한다.
4. `DebugView`는 고정형 타임라인/레일로 재설계되어 각 agent/subagent tool start/done/event sequence를 보여주고, parent-child 관계를 시각적으로 연결한다.
5. Agent label dot 혹은 Inspector 영역에서 `inferred waiting`, `permission pending (heuristic)` 같은 리마인더를 넣어 heuristic 상태도 신뢰도 있게 보여준다.

## 제안된 개발 순서
1. **상태 모델 확장** (`src/transcriptParser.ts`, `src/timerManager.ts`, `src/types.ts`):
   - `ToolActivity` 인터페이스 확장, 각 tool start/done에서 `startTime`, `duration`, `confidence`, `parentToolId` 등 채우기.
   - `processCodexTranscriptLine`, `processClaudeTranscriptLine`에서 문자열 출력 대신 객체를 만들고 `agentToolStart`, `agentToolDone`, `agentStatus`, `agentToolPermission`에 객체가 담기도록 보장.
2. **데이터 전달 흐름 정비** (`webview-ui/src/hooks/useExtensionMessages.ts`):
   - 새로운 `ToolActivity` 타입을 사용하고, `agentTools`, `subagentTools`를 업데이트할 때 필드가 보존되도록 리팩터링.
3. **Inspector UI 도입** (`webview-ui/src/office/components/ToolOverlay.tsx`, `webview-ui/src/App.tsx`, `webview-ui/src/components/AgentLabels.tsx`):
   - Tooltip/overlay를 “pin-able inspector”로 탈바꿈. 선택한 agent에 대한 `current task`, `last 5 actions`, `permission/waiting badge`, `confidence badge`, `subagent tree`, `start/elapsed time`을 표시.
   - 클릭 시 Inspector open을 기본으로 하고, 터미널 포커스는 더블클릭 또는 dedicated button으로 분리.
4. **Timeline DebugView** (`webview-ui/src/components/DebugView.tsx`):
   - Agent → subagent 트리를 가로 타임라인으로 시각화. tool events에 duration 표시, permission/waiting highlight, event jump 버튼 제공.
5. **문서 정리** (`README.md` + 이 문서):
   - README에 `Inspector`/`Timeline`/`Confidence` UI 설명 추가.
   - 이 문서(docs/agent-visibility-plan.md)와 향후 추가될 구현 노트(예: `docs/agent-visibility-impl.md`)를 기준으로 개발.

## 다음 단계
- PR 생성 시 이 문서를 참조하고, 주요 변경 사항(모델, UI, timers 등)을 한 줄 요약으로 적는다.
- 개발 중 무언가 비정상적으로 작동하면 이 문서의 DoD와 비교하고, 해결 정보를 이 파일에 적어 추적한다.

## 현재 상태
- [x] ToolActivity 모델을 확장하고, transcript parser/agent state/permission 타이머에서 새 필드를 채워 `agentToolStart`/`agentToolDone` 메시지에 포함
- [x] Webview에서 `agentTools`/`subagentTools`에서 확장된 `ToolActivity`를 유지하고, permission 메시지가 필드까지 갱신
- [x] Inspector/Timeline UI가 새 데이터로 시각화하고 클릭 흐름 조정 (ToolOverlay/DebugView/App 업데이트)
