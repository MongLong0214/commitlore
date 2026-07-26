# ADR-0002: 구현 언어·런타임 — TypeScript + Node 20, npm/npx 배포

> ⚠️ **런타임 하한은 [ADR-0010](ADR-0010-node-floor.md)으로 대체됐다.** 지원 하한은 Node 20이 아니라 **Node 22**다 — Node 20은 2026-04-30에 EOL이 됐고, 의존성 두 개가 이미 그 하한을 지키지 않고 있었다.
> 언어(TypeScript strict)·배포 채널(npm/npx)·단일 패키지 결정은 **그대로 유효하다.** 이 문서에 남은 "Node 20" 표기는 결정 이력이므로 보존한다.

- Status: Accepted (2026-07-26) · 런타임 조항 Superseded by ADR-0010 (2026-07-26)

## Context

CLI·MCP 서버·훅·GitHub Action을 4주 안에 구현해야 한다. 배포 채널은 npm(`npx commitlore`)과 skills.sh 생태계. 오너 스택은 TypeScript 중심.

## Decision

- 언어: TypeScript (strict), 런타임: Node ≥ 20. 단일 패키지 `commitlore` (bin: `commitlore`).
- 배포: npm publish + `npx commitlore <cmd>`. MCP 서버는 같은 패키지의 서브커맨드(`commitlore mcp`).
- 인덱스 저장: better-sqlite3 (네이티브 의존 1개 허용 — ADR-0003의 파생 캐시이므로 실패 시 무인덱스 폴백 경로 유지).
- git 접근: 자식 프로세스로 시스템 `git` 호출 (`interpret-trailers`, `log --format=%(trailers)`, `notes`). libgit2 바인딩 금지.

## Ruled-out

- Rust 단일 바이너리 | 배포·성능 우위는 인정하나 4주 제약과 팀 스택 불일치. Backlog에서 재평가 가능
- Bun 런타임 | 훅·CI 환경 호환성 검증 비용. Node가 최소 리스크
- libgit2/isomorphic-git | git 네이티브 trailer 기능(`interpret-trailers`)이 정확성의 원천 — 시스템 git 위임이 가장 단순하고 검증 용이

## Consequences

- 코어 조회 경로는 LLM·네트워크 0 의존 (비용 0 원칙 정합).
- better-sqlite3 설치 실패 환경(사내 프록시 등)에서는 `--no-index` 폴백으로 기능 저하 없이 느리게 동작해야 한다 (T-203 AC).
