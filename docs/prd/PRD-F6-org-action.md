# PRD F6 — Org 최소분 (GitHub Action: PR lint + squash 승계)

- Milestone: M4 (08-23) · ADR: 0003, 0004

## 목표
팀 단위 품질 루프를 사용자 자신의 무료 CI에서 돌린다. 서버·DB·과금 0 (셀프호스트 원칙).

## 비목표
조직 결정 그래프·대시보드(Backlog), 승인 게이트 자동화(Backlog — v0.1은 lint 리포트까지).

## 사용자 스토리
- 리뷰어로서, PR에 "이 PR이 건드리는 파일의 활성 제약 + trailer lint 결과" 코멘트가 자동으로 달린다.
- squash-merge 시 Action이 trailer 승계를 자동 수행해 지식 소실이 없다.

## 요구사항
1. Action 1: `commitlore validate` + 대상 경로 활성 제약 요약을 PR 코멘트로 게시(사용자 GITHUB_TOKEN, 외부 전송 없음).
2. Action 2: 병합 이벤트에서 `commitlore squash-preserve` 실행 + notes push.
3. 배포: 이 레포의 `action.yml` 재사용 워크플로우로 제공, README 설치 3줄.

## AC
- [ ] 데모 저장소에서 PR 생성→코멘트 게시→squash 병합→main 조회 성공 E2E 1회 녹화(로그)
- [ ] 외부 네트워크 호출 0 (GitHub API 제외) 검증
