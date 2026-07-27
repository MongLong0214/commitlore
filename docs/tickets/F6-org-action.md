# F6 티켓 — Org Action (M4)

> PRD: `docs/prd/PRD-F6-org-action.md` · ADR: 0003, 0004
> 배치: `action/lint/action.yml`, `action/preserve/action.yml`, `.github/workflows/demo-*.yml`

---

## T-601 Action: PR lint + 활성 제약 코멘트 (M) — #20 · 의존 T-202, T-204

**구현 개요**
- composite action: checkout(fetch-depth 0 + notes refspec) → `node dist/cli.js validate --range origin/<base>..HEAD` → 변경 경로별 `commitlore context --json` → 단일 코멘트 업서트(마커 주석으로 갱신, 도배 금지).
- 권한: `pull-requests: write`만. 외부 네트워크 호출 0(GitHub API 제외) — 코드 리뷰에서 fetch/axios 부재 검증.
- 실패 정책: lint 위반 = check fail, 제약 요약은 정보성.

**테스트**: 데모 워크플로우로 셀프 저장소 PR에서 실동작 로그 확보.
**AC**: PRD-F6 AC 1·2.

---

## T-602 Action: squash 승계 자동화 (M) — #21 · 의존 T-302, T-601

**구현 개요**
- 트리거: `pull_request: closed` + `merged == true` + squash 병합 감지(병합 커밋 부모 수/커밋 메시지 패턴).
- 동작: T-302 코어 함수로 브랜치 기록 집계 → 병합 커밋 notes 부착(`Provenance: inherited`) → `git push origin refs/notes/commitlore`.
- 권한: `contents: write`.

**테스트**: 데모 저장소 E2E — PR 생성→lint 코멘트→squash 병합→`commitlore limits`로 PR 대상 브랜치에서 조회 성공, 로그 아카이브.
**AC**: PRD-F6 AC 1 (E2E 1회 녹화 로그).
