# ADR-0011: 배포 — 레지스트리 없는 git 배포, 에이전트 무관 통합

- Status: Accepted (2026-07-26)
- Supersedes: ADR-0002의 **배포 채널** 조항(`npm publish` + `npx commitlore`). 언어(TypeScript strict)·런타임(Node, ADR-0010의 하한 ≥22)·단일 패키지 결정은 **그대로 유효하다.**

## Context

ADR-0002는 4주 일정과 오너 스택을 근거로 npm을 배포 채널로 골랐다. 그때의 가정은 "CLI를 쓰는 사람이 설치한다"였다. 실제 사용자는 사람이 아니라 **에이전트**이고, 에이전트는 하나가 아니다 — Claude Code, Codex, Gemini CLI, Cursor, Cline, Windsurf, Zed, Qwen Coder, Kimi가 각자 다른 통합 표면을 쓴다.

npm을 채널로 두면 세 가지가 따라온다.

1. **오너에게 릴리스 의식이 생긴다.** 실제로 첫 배포가 2FA OTP에서 막혔다. 레지스트리 계정·토큰·publish 단계가 릴리스마다 반복된다.
2. **사용자에게 생태계 색이 묻는다.** 파이썬·Go 저장소에서 일하는 에이전트에게 `npm install -g`를 요구하는 것은, 프로토콜이 git trailer라는 사실과 어긋난다.
3. **에이전트 생태계와 무관하다.** 어떤 에이전트도 npm 레지스트리에서 도구를 찾지 않는다. MCP 설정과 플러그인 마켓플레이스에서 찾는다.

## Decision

**배포는 git clone이다. 레지스트리를 쓰지 않는다.**

- `dist/`를 저장소에 커밋한다. 빌드 단계가 없다.

> ✅ **닫혔다** (2026-07-26, #38). `dist/commitlore.mjs`는 esbuild 번들이라 의존성을
> 함께 담는다. 의존성 없는 clone에서 `--version`·`validate`·`ruled-out`·`guard`·
> `doctor`·`mcp`(도구 3종) 전부 실측 확인했다. `better-sqlite3`만 external이고,
> 없으면 `--no-index`로 degrade한다.
- Claude Code용으로 저장소 자체가 플러그인이자 마켓플레이스다(`.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`, `source: "./"`).
- 그 외 모든 에이전트의 1급 표면은 **MCP 서버**(`commitlore mcp`, stdio, protocol 2024-11-05, 도구 3종)다. 클라이언트에 붙이는 설정은 어디서나 동일한 JSON 한 덩어리다.
- 셸만 쓸 수 있는 에이전트를 위해 `AGENTS.md`를 제공한다. `AGENTS.md`는 Codex·Qwen·Kimi·Gemini·Cursor가 공유하는 사실상의 표준이다.
- 도구가 전혀 없어도 되는 경로를 유지한다: 기록은 git trailer이므로 `git log --format='%(trailers:...)'`로 어떤 언어에서든 읽힌다.

## Ruled-out

- **npm 유지 + 플러그인 병행** | 채널이 둘이면 버전이 갈라지고, 릴리스마다 OTP 의식이 남는다. 레지스트리가 주는 것은 버전 해석과 발견성인데 플러그인 마켓플레이스가 둘 다 제공한다
- **`dist/` 미커밋 + 설치 시 npm install** | 매 세션 시작에 네트워크를 태우고, 결국 레지스트리 의존이 그대로 남는다. 오프라인·사내 프록시 환경에서 조용히 실패한다
- **`dist/` 미커밋 + 소스 빌드 요구** | 설치에 툴체인을 요구하는 순간 "clone 하나로 끝"이 깨진다
- **커밋 훅 자동 설치를 플러그인에 포함** | 사용자 저장소의 `.git/hooks`를 동의 없이 건드리는 것은 설치가 할 일이 아니다. `commitlore hooks install`은 명시적 선택으로 남긴다

## Consequences

- **릴리스 = 태그 push.** publish 계정도 토큰도 없다. 플러그인 버전은 `plugin.json`의 `version`, 혹은 생략 시 git 커밋 SHA로 해석된다.
- **`dist/` drift가 새 위험이다.** 커밋된 빌드 산출물이 `src/`와 어긋나면 낡은 코드가 배포된다. 빌드가 결정적임을 확인했고(동일 입력 → 동일 해시), CI가 재빌드해 한 바이트라도 다르면 실패시킨다. `.gitattributes`가 `dist/**`를 generated로 표시해 리뷰 diff를 오염시키지 않는다.
- **Node 런타임 의존은 남는다.** 이 ADR이 없앤 것은 레지스트리이지 런타임이 아니다. 인덱스·guard·등급·MCP는 TypeScript다. 단일 정적 바이너리는 ADR-0002가 일정 때문에 기각했고 #39에서 재평가한다.
- **`package.json`은 남는다.** 빌드·의존성·타입체크에 필요한 개발 산출물이며 배포 채널이 아니다. `files`/`bin` 필드는 레지스트리를 쓰지 않는 한 아무 효과가 없다.
- 다른 언어 구현 경로는 강화된다 — `spec/fixtures/`와 `spec/contract-cases/`가 적합성 스위트이고, 이제 그것을 얻는 데 어떤 패키지 매니저도 필요 없다.
