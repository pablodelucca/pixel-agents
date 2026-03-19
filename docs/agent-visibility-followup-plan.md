# Agent Visibility 후속 구현 계획서

## 목적

`docs/agent-visibility-plan.md` 기준으로 1차 구현은 완료되었지만, 아직 “문서 기준 완전 구현” 상태는 아니다.  
이 문서는 **남은 갭을 명확히 정의하고**, 다른 Agent가 바로 구현할 수 있도록 **작업 단위, 파일 범위, 완료 기준, 검증 방법**까지 정리한 후속 실행 계획서다.

---

## 현재 상태 요약

### 이미 구현된 것
- `ToolActivity` 구조화 필드 추가
- transcript parser → timerManager → webview state 흐름 연결
- Inspector 형태의 `ToolOverlay` 추가
- timeline 스타일의 `DebugView` 1차 추가
- README / docs 업데이트

### 아직 부족한 것
- 클릭 → Inspector selection 흐름이 extension 쪽과 완전히 연결되지 않음
- tool history가 turn 종료 시 사라져 “최근 작업 이력”이 충분히 남지 않음
- `confidence`, `source`, `inferred` 값이 실질적으로 활용되지 않음
- `waiting` / `permission`이 heuristic이라는 점이 UI에 명확히 드러나지 않음
- `DebugView`가 아직 진짜 시간축 기반 rail/timeline은 아님
- `AgentLabels`가 App에 실제 마운트되지 않음

---

## 목표 상태

다음 상태가 되면 후속 작업 완료로 본다.

1. 사용자가 에이전트를 클릭하면 **항상 Inspector가 열린다**
2. Inspector는 **현재 작업 + 최근 이력 + heuristic 여부 + permission 상태 + subagent 관계**를 명확히 보여준다
3. DebugView는 **실제 시간 흐름이 있는 timeline/rail**처럼 보인다
4. waiting / permission / confidence 정보는 **추정인지 확정인지 구분**된다
5. 최근 툴 이력은 turn clear 이후에도 일정 개수 유지된다

---

## 작업 분해

## Phase A — 클릭/선택 흐름 정리

### 문제
- `webview-ui/src/App.tsx`에서 `agentSelected` 메시지를 extension으로 보내고 있지만,
- `src/PixelAgentsViewProvider.ts`의 `onDidReceiveMessage`에는 해당 메시지 처리기가 없다.
- 현재는 webview 내부에서만 `agentSelected`를 받도록 돼 있어 흐름이 어색하다.

### 목표
- 클릭 시 Inspector selection이 일관되게 동작하도록 정리
- terminal focus와 selection을 완전히 분리

### 구현 방안

#### 옵션 A (권장)
`agentSelected`를 **extension으로 보내지 말고 webview 내부 state로만 처리**한다.

#### 해야 할 일
- `webview-ui/src/App.tsx`
  - `handleClick`에서 `vscode.postMessage({ type: 'agentSelected' ... })` 제거
  - 대신 `officeState.selectedAgentId`를 직접 갱신할 수 있도록 구조 변경
- `webview-ui/src/hooks/useExtensionMessages.ts`
  - `selectedAgent`를 내부 state source of truth로 정리
- 필요시 `App.tsx`에서 `setSelectedAgent`를 노출하는 별도 방식 추가

#### 대안
extension까지 selection을 전파하고 싶다면:
- `src/PixelAgentsViewProvider.ts`
  - `message.type === 'agentSelected'` 처리 추가
  - 다시 webview에 broadcast하는 구조 정리

### 완료 기준
- agent 클릭 시 항상 Inspector가 열림
- subagent 클릭 시 parent inspector가 열림
- terminal focus는 Inspector 버튼으로만 수행됨

### 검증
- 일반 agent 클릭
- subagent 클릭
- debug mode on/off 상태에서 selection 유지 확인

---

## Phase B — Tool history 보존 구조 추가

### 문제
- 현재 `agentToolsClear`에서 tool 목록이 통째로 삭제된다.
- 그래서 Inspector의 “Recent tools”가 실제 recent history가 아니라 “현재 턴의 남은 정보”에 가깝다.

### 목표
- 최근 N개(권장 20개)의 tool history를 agent별로 유지
- active tools와 history를 분리

### 구현 방안

### 새 상태 제안
- `activeAgentTools: Record<number, ToolActivity[]>`
- `agentToolHistory: Record<number, ToolActivity[]>`
- `activeSubagentTools: Record<number, Record<string, ToolActivity[]>>`
- `subagentToolHistory: Record<number, Record<string, ToolActivity[]>>`

### 파일
- `webview-ui/src/hooks/useExtensionMessages.ts`
- 필요시 `src/types.ts` / `webview-ui/src/office/types.ts`

### 세부 작업
- `agentToolStart`: active list에 추가
- `agentToolDone`: active item 업데이트 후 history에도 append
- `agentToolsClear`: active만 비우고 history는 유지
- history 최대 길이 제한(예: 20)

### 완료 기준
- turn 종료 후에도 Inspector의 recent tools가 남아 있음
- waiting 상태 진입 후에도 직전 작업 확인 가능
- subagent history도 parent context 아래에서 확인 가능

### 검증
- tool 3개 이상 실행 후 turn 종료
- permission 대기 후 clear
- subagent 생성/종료 반복

---

## Phase C — heuristic / confidence / source 실제 반영

### 문제
- 현재 `confidence`는 사실상 고정값
- `source`, `inferred`는 타입만 있고 거의 안 쓰임

### 목표
- 상태가 transcript 기반인지 heuristic 기반인지 구분
- UI에서 “확정/추정”을 명시

### 권장 규칙

#### source
- transcript에서 직접 파생된 tool start/done: `source = 'transcript'`
- timer 기반 waiting/permission 감지: `source = 'heuristic'`

#### inferred
- `startWaitingTimer`로 발생한 waiting: `true`
- `startPermissionTimer`로 발생한 permission pending: `true`
- transcript에서 직접 온 tool event: `false`

#### confidence
- direct transcript tool event: `high`
- transcript + partial inference: `medium`
- pure timer heuristic: `low`

### 파일
- `src/transcriptParser.ts`
- `src/timerManager.ts`
- `src/fileWatcher.ts`
- `webview-ui/src/hooks/useExtensionMessages.ts`

### 완료 기준
- waiting badge가 `heuristic`로 표시 가능
- permission pending이 `heuristic`로 표시 가능
- Inspector에서 confidence/source를 텍스트로 보여줌

### 검증
- tool start 시 `confidence=high`
- idle waiting 시 `inferred=true`, `source=heuristic`
- permission timer 발생 시 `inferred=true`, `source=heuristic`

---

## Phase D — Inspector 완성도 향상

### 문제
- 현재 ToolOverlay는 Inspector 형태이긴 하지만,
- 문서에서 의도한 “current task + last 5 actions + heuristic badge + subagent tree + elapsed info”를 완전 충족하지는 못한다.

### 목표
- ToolOverlay를 “고정형 Inspector 패널”로 완성

### 세부 요구사항

#### 반드시 포함
- Agent 이름 / ID
- 현재 상태
- 현재 tool
- target / command
- elapsed time
- confidence badge
- `inferred waiting`, `permission pending (heuristic)` 표시
- 최근 5개 actions
- subagent tree

#### 있으면 좋은 것
- adapter type (`codex` / `claude`)
- projectDir 또는 folderName
- 마지막 상태 변경 시간

### 파일
- `webview-ui/src/office/components/ToolOverlay.tsx`
- `webview-ui/src/App.tsx`

### UI 원칙
- 선택 agent가 없으면 패널 숨김
- `alwaysShowOverlay`는 mini overlay 용도로 제한하거나 의미 재정의
- Inspector와 world-anchored tooltip을 분리할지 검토

### 완료 기준
- 툴팁이 아니라 명확한 Inspector 느낌
- waiting/permission이 “추정”인지 보임
- recent tools가 현재 turn 외 이력도 보여줌

---

## Phase E — DebugView를 실제 timeline rail로 개선

### 문제
- 현재는 duration 너비를 가진 chip list 수준
- 문서 기준의 “고정형 타임라인/레일”은 아님

### 목표
- agent / subagent / time 흐름이 한눈에 보이는 debug timeline 제공

### 구현 방향

#### 시각 구조
- 세로축: agent
- 중첩 row: subagent
- 가로축: 시간
- bar:
  - active tool
  - done tool
  - waiting
  - permission pending

#### 필요한 데이터
- tool `startTime`
- `durationMs`
- waiting 시작 시각
- permission pending 시작 시각

### 추가 상태 제안
- `agentStatusHistory`
- `subagentStatusHistory`

### 파일
- `webview-ui/src/components/DebugView.tsx`
- `webview-ui/src/hooks/useExtensionMessages.ts`

### 완료 기준
- 시간이 흐를수록 오른쪽으로 bar가 늘어나거나 누적됨
- parent / child 관계가 indent나 connector로 드러남
- waiting / permission이 distinct color/event row로 보임

---

## Phase F — AgentLabels 실제 연결

### 문제
- `webview-ui/src/components/AgentLabels.tsx`는 존재하지만 App에서 사용되지 않음

### 목표
- 메인 캔버스에서 최소 상태 요약을 항상 볼 수 있게 함

### 표시 내용
- Agent label
- active / waiting dot
- optional: 현재 작업 요약 1줄
- heuristic waiting일 경우 `?` 또는 low-confidence badge

### 파일
- `webview-ui/src/App.tsx`
- `webview-ui/src/components/AgentLabels.tsx`

### 완료 기준
- 캔버스에서 에이전트별 상태를 hover 없이도 파악 가능
- Inspector와 중복되지 않게 미니멀하게 유지

---

## 권장 작업 순서

1. **Phase A** — 클릭/selection 흐름 정리
2. **Phase B** — history 보존 구조 추가
3. **Phase C** — heuristic/confidence/source 실제 반영
4. **Phase D** — Inspector 완성
5. **Phase E** — Debug timeline rail 개선
6. **Phase F** — AgentLabels 연결

---

## PR 분리 권장안

### PR 1
**fix: normalize agent selection and preserve tool history**
- Phase A
- Phase B

### PR 2
**feat: surface heuristic confidence in tool activity**
- Phase C
- 일부 Phase D

### PR 3
**feat: upgrade inspector and debug timeline rails**
- Phase D
- Phase E
- Phase F

---

## 각 PR 공통 체크리스트

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `cd webview-ui && npm run build`
- [ ] codex/claude 각각에서 tool start/done 확인
- [ ] waiting/permission heuristic 상태 수동 검증
- [ ] subagent 생성/종료 흐름 확인

---

## 구현 시 주의사항

1. `agentSelected` 메시지 흐름은 **webview-only** 또는 **extension roundtrip** 중 하나로 통일할 것
2. history와 active tools를 섞지 말 것
3. heuristic 상태는 반드시 UI에서 “추정”이라고 표기할 것
4. `confidence`는 실제 규칙 기반으로 채울 것. placeholder 값 금지
5. DebugView는 단순 카드 나열로 끝내지 말 것

---

## 완료 판정 기준

아래가 모두 만족되면 `docs/agent-visibility-plan.md`가 실질적으로 구현되었다고 본다.

- [ ] ToolActivity 메타가 실제 의미 있게 채워짐
- [ ] Inspector가 current + recent + heuristic + subagent 관계를 명확히 보여줌
- [ ] DebugView가 실제 timeline rail 역할을 함
- [ ] 클릭 흐름이 일관적임
- [ ] AgentLabels 또는 equivalent mini status가 캔버스에 존재함
