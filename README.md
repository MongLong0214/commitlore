# Lore

**Git commit trailers as institutional memory for AI coding agents.**
Free forever. MIT. No plans, no server, no extra cost — **git is the single source of truth.**

> 상태: v0.1.0 개발 중 (목표 2026-08-23). 설계 문서는 `docs/`, 작업은 GitHub Issues/Milestones 참조.

## Why

에이전트는 매 세션 죽는 시니어 개발자다. 결정 맥락(제약·기각된 대안·경고)은 커밋과 함께 증발한다.
Lore는 그 맥락을 **git 네이티브 trailer**로 커밋에 각인하고, 에이전트가 파일을 만지는 순간 자동으로 되돌려준다.

- **캡처는 공짜**: 에이전트 transcript에서 자동 수확, 검증자가 근거 대조
- **소비는 push**: 경로 스코프 주입 + `lore guard`(기각된 접근 재제안 차단)
- **워크플로우 생존**: squash 승계 + notes 미러 + `--follow`
- **진실은 git에만**: 인덱스·대시보드는 전부 재생성 가능한 파생물

## Architecture (v0.1)

| 계층 | 내용 |
|---|---|
| L0 Protocol v2 | 스펙 + JSON Schema + 적합성 스위트 (`docs/`, F1) |
| L1 Core CLI | parse / validate / query / index / stale / squash-preserve (F2·F3) |
| L2 Agent Fabric | lore-mcp · 주입 훅 · 자동 수확+검증자 · guard · skills (F4) |
| L3 Trust (minimal) | 등급 모델 · Directive 강등 · secret guard (F5) |
| L4 Org | GitHub Action: PR lint + squash 승계 (F6) |
| L5 LoreBench | 재제안율 · 어블레이션 lite · CPAA (F7) |

설계 결정은 `docs/adr/`, 요구사항은 `docs/prd/`, 작업 단위는 `docs/tickets/` + GitHub Issues.

## License

MIT
