<h1 align="center">
    <a href="https://github.com/DavidUmKongs/oh-my-pixel-agents/discussions">
        <img src="webview-ui/public/banner.png" alt="Pixel Agents">
    </a>
</h1>

<h2 align="center" style="padding-bottom: 20px;">
  AI 에이전트가 실제로 일하는 모습을 볼 수 있는 게임형 인터페이스
</h2>

<div align="center" style="margin-top: 25px;">

[![release](https://img.shields.io/github/v/release/DavidUmKongs/oh-my-pixel-agents?display_name=tag&sort=semver)](https://github.com/DavidUmKongs/oh-my-pixel-agents/releases)
[![stars](https://img.shields.io/github/stars/DavidUmKongs/oh-my-pixel-agents?logo=github&color=0183ff&style=flat)](https://github.com/DavidUmKongs/oh-my-pixel-agents/stargazers)
[![license](https://img.shields.io/github/license/DavidUmKongs/oh-my-pixel-agents?color=0183ff&style=flat)](https://github.com/DavidUmKongs/oh-my-pixel-agents/blob/codex/LICENSE)
[![issues](https://img.shields.io/github/issues/DavidUmKongs/oh-my-pixel-agents?color=7057ff&label=issues)](https://github.com/DavidUmKongs/oh-my-pixel-agents/issues)

</div>

<div align="center">
<a href="https://github.com/DavidUmKongs/oh-my-pixel-agents/releases">🚀 릴리즈</a> • <a href="https://github.com/DavidUmKongs/oh-my-pixel-agents/discussions">💬 Discussions</a> • <a href="https://github.com/DavidUmKongs/oh-my-pixel-agents/issues">🐛 Issues</a> • <a href="CONTRIBUTING.md">🤝 Contributing</a> • <a href="CHANGELOG.md">📋 Changelog</a>
</div>

<br/>

<div align="center">
  <strong>언어:</strong> 한국어 • <a href="README.md">English</a>
</div>

<br/>

Pixel Agents는 멀티 에이전트 AI 시스템을 눈으로 보고 관리할 수 있게 바꿔주는 VS Code 확장입니다. 각 에이전트는 픽셀 아트 사무실 속 캐릭터가 되어 걸어 다니고, 책상에 앉고, 실제 작업 상태에 맞춰 행동이 바뀝니다.

현재는 Codex와 Claude Code를 지원하는 VS Code 확장으로 동작하지만, 장기적으로는 특정 에이전트나 특정 플랫폼에 묶이지 않는 범용 오케스트레이션 인터페이스를 목표로 합니다.

이 저장소는 Pixel Agents의 `oh-my-pixel-agents` 포크를 관리합니다. 포크 기준 릴리즈는 이 저장소의 [GitHub Releases](https://github.com/DavidUmKongs/oh-my-pixel-agents/releases)에서 확인할 수 있고, 가장 최신 Codex 중심 변경사항은 소스에서 직접 빌드해 사용할 수 있습니다.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## 주요 기능

- **에이전트 1개 = 캐릭터 1명** — 추적 중인 각 에이전트 터미널이 픽셀 캐릭터로 표현됩니다.
- **실시간 작업 상태 반영** — 파일 읽기, 편집, 명령 실행 같은 실제 작업에 맞춰 캐릭터 애니메이션이 바뀝니다.
- **오피스 레이아웃 에디터** — 바닥, 벽, 가구를 배치해서 나만의 사무실을 만들 수 있습니다.
- **말풍선 알림** — 사용자 입력 대기나 권한 승인 대기 상태를 시각적으로 보여줍니다.
- **사운드 알림** — 에이전트가 턴을 마치면 차임 소리를 낼 수 있습니다.
- **서브에이전트 시각화** — Task 도구로 생성된 서브에이전트가 부모와 연결된 별도 캐릭터로 표시됩니다.
- **고정 Inspector** — 에이전트를 클릭하면 현재 tool, confidence, permission 상태, 최근 이력을 Inspector에서 확인할 수 있습니다.
- **타임라인 Debug View** — Debug 모드에서 agent/subagent/tool 흐름을 rail 형태로 볼 수 있습니다.

<p align="center">
  <img src="webview-ui/public/characters.png" alt="Pixel Agents characters" width="320" height="72" style="image-rendering: pixelated;">
</p>

## 요구 사항

- VS Code 1.105.0 이상
- 확장 개발/빌드를 위한 Node.js 22.12.0 이상
- [Codex CLI](https://developers.openai.com/codex/cli) 또는 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 설치 및 설정

## 시작하기

포크의 최신 변경사항을 사용하려면 이 저장소의 릴리즈를 확인하거나 소스에서 직접 빌드하는 방법이 가장 빠릅니다.

### 소스에서 설치

```bash
git clone https://github.com/DavidUmKongs/oh-my-pixel-agents.git
cd oh-my-pixel-agents
nvm use
npm install
cd webview-ui && npm install && cd ..
npm run build
```

이 저장소는 `.nvmrc`에 Node.js `22.12.0`을 고정해 두었습니다.

그다음 VS Code에서 **F5**를 눌러 Extension Development Host를 실행하세요.

### 검증 방법

설치 직후나 PR 올리기 전에 아래 순서로 확인하면 됩니다.

```bash
npm run check-types
npm run lint
cd webview-ui && npm test && npm run build
```

실제로 올바른 Node 버전을 쓰고 있는지도 먼저 확인하는 것이 좋습니다.

```bash
nvm use
node -v
```

### 사용 방법

1. VS Code 하단 패널에서 **Pixel Agents** 뷰를 엽니다.
2. **Pixel Agents › Agent Type**을 `codex` 또는 `claude`로 설정합니다.
3. **+ Agent** 버튼으로 새 에이전트 터미널과 캐릭터를 생성합니다.
4. 에이전트 CLI로 작업을 시작하면 캐릭터가 상태에 따라 반응합니다.
5. 캐릭터를 클릭해 선택한 뒤, 좌석을 클릭해 자리 배치를 바꿀 수 있습니다.
6. **Layout** 버튼으로 사무실 레이아웃을 편집합니다.

## 레이아웃 에디터

내장 에디터로 사무실을 직접 꾸밀 수 있습니다.

- **Floor** — HSB 색상 조절
- **Walls** — 자동 타일링 벽과 색상 커스터마이징
- **Tools** — 선택, 페인트, 지우기, 배치, 스포이트, 픽
- **Undo/Redo** — Ctrl+Z / Ctrl+Y로 50단계까지
- **Export/Import** — JSON 레이아웃 공유

그리드는 최대 64×64 타일까지 확장할 수 있으며, 바깥쪽 ghost border를 클릭해 확장합니다.

### 오피스 에셋

모든 오피스 에셋(가구, 바닥, 벽)은 `webview-ui/public/assets/` 아래에 완전한 오픈소스로 포함되어 있습니다. 별도 구매나 외부 import 없이 바로 동작합니다.

각 가구는 `assets/furniture/` 아래 자신의 폴더를 가지며, `manifest.json`에 sprite, rotation group, on/off state group, animation frame 정보를 선언합니다. 바닥 타일은 `assets/floors/`, 벽 타일 세트는 `assets/walls/`에 있습니다.

새 가구를 추가하려면 `webview-ui/public/assets/furniture/`에 폴더를 만들고 PNG sprite와 `manifest.json`을 넣은 뒤 다시 빌드하면 됩니다.

## 동작 원리

Pixel Agents는 선택된 백엔드의 JSONL transcript 파일을 감시해서 각 에이전트가 무엇을 하는지 추적합니다. 에이전트가 파일 편집, 검색, 명령 실행 같은 tool을 사용하면 확장이 이를 감지해 캐릭터 애니메이션을 갱신합니다.

웹뷰는 canvas 렌더링, BFS pathfinding, 캐릭터 상태 머신(idle → walk → type/read) 기반의 가벼운 게임 루프 위에서 동작합니다.

## 기술 스택

- **Extension**: TypeScript, VS Code Webview API, esbuild
- **Webview**: React 19, TypeScript, Vite, Canvas 2D

## 현재 제한 사항

- **에이전트-터미널 동기화** — Claude Code 터미널 인스턴스와의 연결이 완전히 견고하지 않아 빠른 생성/종료/복원 과정에서 간헐적으로 desync가 날 수 있습니다.
- **heuristic 기반 상태 감지** — Claude Code transcript에는 waiting/turn completion 신호가 명확하지 않아 idle timer와 turn-duration 이벤트를 섞은 heuristic에 의존합니다.
- **Windows 중심 테스트** — 현재 주 테스트 환경은 Windows 11입니다. macOS/Linux에서도 동작할 수 있지만 파일 감시, 경로, 터미널 처리 차이가 있을 수 있습니다.

## 앞으로의 방향

장기적으로는 AI 에이전트 관리가 Sims처럼 느껴지되, 결과물은 실제 코드와 문서가 되는 인터페이스를 지향합니다.

- **캐릭터로서의 에이전트** — 역할, 상태, 컨텍스트 사용량, tool을 눈으로 확인
- **디렉터리 = 책상** — 특정 프로젝트/작업 공간에 에이전트를 배정
- **프로젝트 = 사무실** — 칸반 보드와 자율 task pickup 같은 흐름
- **더 깊은 Inspector** — 모델, 브랜치, 시스템 프롬프트, 전체 작업 이력 확인
- **완전한 커스터마이징** — 캐릭터 스프라이트, 테마, 오피스 에셋 사용자 정의

이를 위해 구조는 다음 특성을 지향합니다.

- **플랫폼 비종속** — 오늘은 VS Code 확장이지만, 나중엔 Electron/웹 앱 등으로 확장 가능
- **에이전트 비종속** — Claude Code뿐 아니라 Codex, Gemini, Cursor, Copilot 등으로 확장 가능
- **테마 비종속** — 커뮤니티가 만든 테마와 에셋을 쉽게 얹을 수 있는 구조

## 커뮤니티와 기여

질문, 아이디어, 논의는 **[GitHub Discussions](https://github.com/pablodelucca/pixel-agents/discussions)** 에서 진행합니다. **[Issues](https://github.com/pablodelucca/pixel-agents/issues)** 는 버그 리포트 전용입니다.

기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고해 주세요.

## 후원

프로젝트가 도움이 되었다면 후원을 고려해 주세요.

<a href="https://github.com/sponsors/pablodelucca">
  <img src="https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?logo=github" alt="GitHub Sponsors">
</a>
<a href="https://ko-fi.com/pablodelucca">
  <img src="https://img.shields.io/badge/Support-Ko--fi-ff5e5b?logo=ko-fi" alt="Ko-fi">
</a>

## 라이선스

이 프로젝트는 [MIT License](LICENSE)로 배포됩니다.
