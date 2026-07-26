# PRD F3 — 워크플로우 생존 (squash 승계 · notes 미러 · --follow)

- Milestone: M2 (08-09) · ADR: 0004

## 목표
squash·rebase·rename에서 지식이 죽지 않는다. "영구 보존" 주장을 실험으로 반증했던 D3·D4를 도구로 해소한다.

## 사용자 스토리
- squash-merge 팀의 에이전트로서, 병합 후에도 브랜치에서 축적된 Constraint를 main에서 조회할 수 있다.
- 리베이스 후에도 notes 미러를 통해 원자가 생존한다.

## 요구사항
1. `lore squash-preserve <base>..<head>`: trailer 집계 → 병합 커밋 정식 trailer 블록 재기록 + notes 원자 부착. 중복 원자는 Constraint-Id/내용 해시로 dedupe.
2. notes 미러: `refs/notes/lore` 읽기/쓰기 모듈, 조회 경로에 notes 원자 병합.
3. 승계 원자 `Provenance: squashed-from <sha>` 필수.
4. doctor: notes fetch refspec 자동 설정(ADR-0003).

## AC
- [ ] D3 재현 시나리오: squash 병합 후 `lore constraints -- <path>`가 브랜치 원자를 반환
- [ ] rebase -i(재작성) 후 notes 경유 조회 성공
- [ ] clone 직후 doctor 1회 실행으로 팀원 간 notes 동기화 왕복 확인
