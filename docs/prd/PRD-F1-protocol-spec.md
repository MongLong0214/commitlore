# PRD F1 — Protocol v2 스펙 + 적합성 스위트

- Milestone: M1 (08-02) · ADR: 0001, 0005, 0006

## 목표
누가 구현해도 같은 동작이 나오는 단일 정본 스펙. 어휘 enum을 정본화해 구현체 간 동작 분기(D1)를 원천 차단한다.

## 비목표
심볼 앵커링 문법 확정(Backlog), 서명 필드 상세(Backlog — provenance 축만 예약).

## 사용자 스토리
- 구현자로서, JSON Schema와 픽스처만 보고 파서를 만들어 적합성 스위트를 통과시킬 수 있다.
- 에이전트로서, 어휘 enum이 유일해 `Certainty: yes` 같은 형식 오류가 기계 거부된다.

## 요구사항
1. trailer 어휘: v1 9종 + `CommitLore-Version` `Decision-Id` `Record-Id` `Supersedes` `Expires` `Evidence` `Provenance` + `X-` 확장 네임스페이스.
2. enum 정본: `Certainty: firm|tentative|guess`, `Blast: local|module|system`, `Undo: easy|costly|permanent` (레포 계열 채택 — 이유: 이미 배포된 스킬 사용자와의 호환).
3. 문법: git interpret-trailers 호환(멀티라인 폴딩 포함) + EBNF.
4. **죽은 필드 금지**: 모든 어휘는 스펙에 소비자 라우트(쿼리·게이트·주입 규칙) 1개 이상을 명시.
5. 적합성 스위트: 파서 왕복 픽스처 + 라우트 계약 테스트(stale 판정·승인 게이트 라우팅·Warn 강등).

## AC
- [ ] SPEC.md + JSON Schema 커밋, 픽스처 ≥ 20개(정상 10·경계 5·거부 5)
- [ ] 라우트 계약 테스트 케이스 ≥ 8개 정의(실행은 F2에서)
- [ ] 어휘표의 모든 행에 소비자 라우트 열 존재 (빈 칸 0)
