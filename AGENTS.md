<!-- Generated: 2026-03-25 | Updated: 2026-03-25 -->

# WorkPane (PromptManager)

## Purpose
Electron 기반의 프롬프트 관리 데스크톱 애플리케이션. 프로젝트 워크스페이스를 열어 문서 탐색, 칸반 이슈 관리, 터미널 (tmux 스타일 분할 레이아웃), 코드/마크다운 편집, 프롬프트 생성을 하나의 통합 환경에서 제공한다.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | 프로젝트 의존성 및 빌드 스크립트 (name: workpane) |
| `electron.vite.config.ts` | electron-vite 빌드 설정 (main/preload/renderer 3분할) |
| `tsconfig.json` | TypeScript 루트 설정 (node/web 프로젝트 참조) |
| `.gitignore` | Git 무시 패턴 |
| `LICENSE` | 라이선스 파일 |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | 애플리케이션 소스 코드 (see `src/AGENTS.md`) |
| `docs/` | 설계 문서, 계획, 리서치 (see `docs/AGENTS.md`) |
| `resources/` | 정적 리소스 및 스킬 템플릿 (see `resources/AGENTS.md`) |
| `.github/` | GitHub Actions 워크플로우 |

## For AI Agents

### Architecture Overview
```
Electron App (electron-vite)
├── Main Process (src/main/)      — Node.js, IPC 핸들러, PTY, 파일시스템
├── Preload (src/preload/)        — contextBridge API 노출
├── Renderer (src/renderer/)      — React 19 SPA
├── Shared (src/shared/)          — main/renderer 공유 타입
└── CLI (src/cli/)                — commander 기반 CLI 도구
```

### Tech Stack
- **Runtime**: Electron 41 + electron-vite
- **Frontend**: React 19, TypeScript 5.5
- **Editor**: Milkdown (마크다운 WYSIWYG), CodeMirror 6 (코드)
- **Terminal**: xterm.js + node-pty
- **State**: React Context (TerminalContext, EditorContext, IssueContext, KanbanContext, ThemeContext)
- **i18n**: i18next (ko/en)
- **File Watch**: chokidar 5
- **Build**: electron-builder (Win/Mac/Linux)

### Working In This Directory
- `npm run dev`로 개발 서버 실행
- `npm run build && npm run build:win`으로 프로덕션 빌드
- node-pty는 네이티브 모듈 — `@electron/rebuild` 필요
- IPC 통신은 preload에서 정의된 API를 통해서만 (contextBridge)

### Key IPC Channels
| Channel Prefix | Domain |
|----------------|--------|
| `terminal:*` | 터미널 생성/데이터/리사이즈/종료 |
| `workspace:*` | 워크스페이스 열기/닫기/상태 |
| `fs:*` | 파일 CRUD (readFile, writeFile, readDir, mkdir, rename, delete) |
| `issues:*` | 문서 기반 이슈 스캔/CRUD |
| `kanban:*` | 칸반 보드 CRUD, 프롬프트 생성, 문서 링크 |
| `search:*` | 파일 내용 검색/치환 |
| `watcher:*` | 파일 변경 감시 |
| `settings:*` | 앱 설정 관리 |
| `skills:*` | 스킬 템플릿 관리 |
| `recovery:*` | 크래시 복구 |

### Testing Requirements
- 현재 테스트 프레임워크 미설정
- 변경 후 `npm run build`로 타입 체크 및 빌드 검증

### Performance Notes
- `scanAllDocs()`의 전체 리스캔이 22~33초 소요 (Lazy Scan 전환 계획 중)
- Windows Defender 실시간 스캔이 I/O 성능에 영향

## Dependencies

### External (Core)
- `electron` 41 — 데스크톱 런타임
- `react` 19 + `react-dom` — UI 프레임워크
- `@milkdown/*` 7.19 — 마크다운 WYSIWYG 에디터
- `codemirror` 6 + `@codemirror/*` — 코드 에디터
- `@xterm/xterm` 6 + `node-pty` — 터미널 에뮬레이션
- `chokidar` 5 — 파일 시스템 감시
- `electron-store` — 설정 저장
- `i18next` + `react-i18next` — 국제화
- `lucide-react` — 아이콘
- `mermaid` — 다이어그램 렌더링
- `katex` — LaTeX 수식 렌더링
- `commander` — CLI 파서

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
