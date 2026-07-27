# 인수인계 — CommitLore · gitseed · repo-factory

> 이 문서는 갱신을 강제하는 검사가 없다. 이전 판은 25커밋 동안 거짓이었고
> 아무것도 잡지 못했다. **여기 적힌 수치를 믿기 전에 §1의 명령을 직접 돌려라.**
> 정본은 `docs/ROADMAP-TO-DONE.md`이고 이 문서는 그 입구다.

---

## 0. 먼저 알아야 할 함정 — 전부 실제로 당했다

**로컬 테스트 통과는 CI 통과가 아니다.** CI가 8커밋 연속 빨간불인 동안 "초록"이라고
다섯 번 잘못 보고했다. 로컬 스위트는 그 8커밋 전부에서 통과했다.

```bash
gh run list --repo MongLong0214/commitlore --limit 1 --json headSha,headBranch,conclusion
```

**브랜치가 바뀌었다.** 기본은 `dev`, `main`은 보호돼 있고 `release-*`·`hotfix-*`만
병합된다. 작업은 `feat-issue-<id>`를 `dev`에서 잘라서 한다. `--no-ff` 필수.

**`git add -A` 금지.** 문서 두 개가 무관한 커밋에 실려갔다. 경로를 지정한다.

**`git reset --hard` 금지.** 커밋 안 된 세 파일이 사라졌다. 위임이 도는 중엔 특히.

**파이프 뒤의 `$?`는 파이프의 것이다.** `cmd | sed` 뒤에서 exit code를 두 번 오판했다.

**위임 보고는 주장이다.** 1108 기준에 943 통과를 보고받은 적이 있다(동시 실행 중
부분 수집). `Test Files N passed`도 함께 받고, **수정은 자기 테스트가 아니라 원래
사건에 대고 검증한다.**

**레포당 위임 1건.** 다른 레포끼리는 병렬 가능, 같은 워크트리는 순차.

전체 목록: `~/.claude/skills/repo-factory/references/self-improvement-loop.md`

---

## 1. 지금 상태를 직접 확인하는 명령

```bash
# 두 레포의 Phase 4 게이트 — exit 0 이어야 한다
python3 ~/.claude/skills/repo-factory/scripts/phase-gate.py 4 \
  --repo MongLong0214/commitlore --path ~/projects/annals
python3 ~/.claude/skills/repo-factory/scripts/phase-gate.py 4 \
  --repo MongLong0214/gitseed --path ~/projects/gitseed

# CI — 로컬 실행이 아니라 이것을 본다
gh run list --repo MongLong0214/commitlore --limit 1
gh run list --repo MongLong0214/gitseed --limit 1

# 테스트
cd ~/projects/annals && npx vitest run
cd ~/projects/gitseed && python3 -m pytest tests/ -q
```

---

## 2. 오너 확정 사항 — 협상 대상 아님

| 항목 | 내용 |
|---|---|
| 비용 | **무료 영구.** 유료 티어·SaaS·과금 없음 |
| 오리지널리티 | 은퇴 어휘 부활 금지 — Constraint / Rejected / Directive / Scope-risk / Reversibility / Confidence / Tested / Not-tested / Related |
| 위임 | 코드 수정은 `codex exec -m gpt-5.6-sol` 또는 `-m gpt-5.6-terra`. 2026-07-27 지시가 이전의 codex 금지 결정을 대체 |
| 역할 | 운영자는 CTO — 최종 판단·심층 검토·리뷰. 직접 코드 수정 안 함 |
| 외부 행동 | 실제 star/follow 수행 금지. 승인 계약과 dry-run 기본을 유지 |

---

## 3. 세 목표와 남은 것

정본: `docs/ROADMAP-TO-DONE.md`

**목표 1 — CommitLore 프로덕션 레디.** 프로덕션 재리뷰 7블로커 전건 종결.
남은 Phase 2개: 플러그인 매니페스트가 관례 위치 `hooks`를 재선언(이중 등록 유력,
매니페스트 테스트 전무) · **M4 설계·실행** + 릴리스 게이트 전항.

**목표 2 — gitseed v0.2.** PRD 접수, ADR 11개·티켓·이슈 정비 완료.
**ADR-0005가 PRD 순서를 뒤집는다** — 점수 기계 장치보다 M0 백테스트가 먼저다.

**목표 3 — repo-factory.** `phase-gate.py`가 양방향 실증됨(진짜 결손 6건 포착,
거짓 실패 1건 노출 후 수정). 남은 것: 스크립트 2개의 raw traceback, 게이트가
Phase 4만 덮음, 게이트가 CI 러너에 없음.

---

## 4. 벤치마크에 대해 반드시 알 것

**M3는 무효다.** 훅이 워킹 카피의 `dist/`를 읽는 동안 운영자가 12시간에 8번
재빌드했다. 처치가 실행 중에 바뀌었다(`bench/PREREGISTRATION.md` §15).
데이터는 `bench/results/*-invalidated*`로 보존한다. **결과로 인용 금지.**

**공개 수치는 전량 철회했다.** 어떤 데이터셋도 자기를 만든 바이너리를 증명하지
못한다. README 4개 언어가 철회 문구를 싣고 있고 `scripts/check-readme-numbers.mjs`가
그걸 강제한다 — **출처 있는 데이터셋이 생겼는데 README가 아직 철회 상태면 실패한다.**

**M1·M2가 null이었던 이유는 측정됐다.** 과제 10개 중 **7개가 대조군 기저율 0**이다.
CommitLore 없이도 에이전트가 기각된 접근을 제안하지 않으니 막을 것이 없다. 검정력은
표본이 아니라 기저율이 지배한다(20%면 팔당 n≈98, 80%면 11).

M4는 **과제 자격 라운드**를 먼저 돈다 — 대조군만 돌려 기저율을 재고, 낮은 과제는
처치군을 아예 돌리지 않고 탈락시킨다. 처치군을 보지 않으므로 p-해킹이 아니다.

---

## 5. 도그푸딩 상태

gitseed가 CommitLore를 쓰는 깊이가 곧 CommitLore의 실사용 검증 범위다.

| 경로 | 상태 |
|---|---|
| `validate` (commit-msg 훅) | 오래전부터 활성 — 여기서 결함 3건이 나왔다 |
| `inject` (PreToolUse) | D1에서 연결, 검증 미완 |
| `guard` | 연결됨. **기각 43건이 기록돼 있고 이제 읽힌다** |
| MCP | `.mcp.json` 생성, `tools/list` 미확인 |
| notes 미러 | refspec 설정·ref 존재 |
| CI | 잡 추가, 도구 부재 시 조용히 통과하지 않음 |

**연결 과정에서 CommitLore #53이 나왔다** — 미러된 notes가 `sources`에서 사라져
"미반영"으로 오독된다. 결함은 아니고 `dropMirroredNotes`의 설계지만, 숙련된
작업자가 실제로 오독했다. 하나의 표현이 두 사실을 덮는 형태이고 이번 주에 여섯
번째다.

---

## 6. 어휘 정본 (SPEC §3)

`Limit` · `Ruled-out`(`대안 | 이유`) · `Warn` · `Blast`(local|module|system) ·
`Undo`(easy|costly|permanent) · `Certainty`(firm|tentative|guess) · `Verified` ·
`Unverified` · `Record-Id`(`r-[a-z0-9]{6,}`) · `Follows` · `Supersedes` ·
`Expires` · `Evidence` · `Provenance`(authored|inherited &lt;sha&gt;|reconstructed|unknown) ·
`CommitLore-Version` · `X-<Name>` 확장.

**자유 텍스트 키는 전부 인젝션 표면이다.** 스캐너는 배제 목록으로 동작한다 —
enum·id 형태·semver만 제외하고 나머지는 전부 스캔한다. 허용 목록이 이 버그를
만들었고, 새 키가 스캔되지 않는 쪽으로 실패하는 것이 위험한 방향이다.
