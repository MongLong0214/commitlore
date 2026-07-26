# 릴리스 티켓 — v0.1.0 (M4)

---

## T-901 v0.1.0 릴리스 (S) — #27 · 의존 T-601, T-704

**체크리스트**
- [x] 태그 push + GitHub 릴리스 — 레지스트리 없음 (ADR-0011)
- [ ] git 태그 `v0.1.0` + GitHub Release — 릴리스 노트는 실측 수치(bench/results)만 인용
- [x] `git clone` 후 `node dist/cli.js --version` / `doctor` 스모크
- [ ] 공개 전환 체크리스트: README 최종 검토 → **오너 승인 후** `gh repo edit --visibility public` (승인 게이트 — 자동 전환 금지)
- [ ] 공개 후 skills.sh 등록(`npx skills add MongLong0214/commitlore`) 확인

**AC**: 위 체크리스트 전부. 미공개 상태에서도 npm 배포·태그까지는 완료 가능.
