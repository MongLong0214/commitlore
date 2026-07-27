# 인수인계 — CommitLore · gitseed · repo-factory

> 이 문서는 갱신을 강제하는 검사가 없다. 이전 판은 25커밋 동안 거짓이었고
> 아무것도 잡지 못했다. **여기 적힌 수치를 믿기 전에 §1의 명령을 직접 돌려라.**
> 정본은 `docs/ROADMAP-TO-DONE.md`이고 이 문서는 그 입구다.

---

## 0. 위임 장애 — 이걸 모르면 한 시간을 날린다

**위임 수단이 바뀌었다.** 서브에이전트(Task/TeamCreate)가 아니라
`codex exec -m gpt-5.6-sol|terra` 다. 오너 지시 2026-07-27이 이전의 codex 금지를
대체한다. 스킬 문서(§Phase 5-D)는 아직 Claude 전용이라고 적혀 있고 그 부분은
낡았다.

**생존 확인은 파일 변경으로만.** 위임 프로세스는 `ps`에 `codex exec`로 뜨지만
완료 여부는 그것으로 판별되지 않는다. 유효한 신호는 두 가지뿐:

```bash
ps -eo pid,etime,command | grep "[c]odex exec"    # 살아있는가
git -C <레포> status --porcelain                   # 실제로 쓰고 있는가
```

출력 파일은 완료 시점까지 **비어 있다**(버퍼링). 0바이트는 실패 신호가 아니다.

**실제로 당한 위임 장애 4종**

| 증상 | 원인 | 판별 |
|---|---|---|
| 테스트 수가 기준보다 적음 (1108→943) | 같은 워크트리에 다른 위임이 동시에 쓰는 중 부분 수집 | `Test Files N passed`를 함께 요구 |
| 파일이 하나도 안 바뀜 | `--cd`가 쓸 수 없는 디렉터리 | 명세의 타깃과 `--cd`가 같은지 확인 |
| 수치가 전부 틀림 | 샌드박스에 `gh` 인증·네트워크 없음 | `--sandbox danger-full-access` 또는 "측정 불가"로 받기 |
| 10분에 잘림 | Bash 도구 한도 | `run_in_background: true` |

**셋 이상 동시 실행 금지.** 레포당 1건, 다른 레포끼리만 병렬.

---

## 0-b. 그 외 함정 — 전부 실제로 당했다

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

### CTO 리뷰 게이트 — 티켓마다, 예외 없음

위임의 "완료했습니다"는 승인이 아니다. 여섯 항목을 **직접** 통과시켜야 커밋한다.

| # | 항목 | 무엇을 하는가 |
|---|---|---|
| 1 | AC 전항목 증거 대조 | 체크박스마다 "무엇으로 증명됐나". 증거 없으면 미완료 |
| 2 | 빌드·테스트 직접 실행 | 보고서의 "통과했습니다"를 믿지 않는다 |
| 3 | 적대적 검토 | 어떻게 깨뜨리나. 특히 프로젝트 자신의 원칙을 위반하는지 |
| 4 | 스코프 검사 | 지시 외 변경, 불필요한 추상화, 미래를 위한 선제 설계 |
| 5 | 일관성 | 공개 문서·ADR 결정과 어긋나지 않는지 |
| 6 | 결정이 기록됐는가 | 기각·제약이 트레일러에 있는가. `validate --commit HEAD` 가 0인가. **착수 전** `guard --proposal`을 돌렸는가 |

불통과 시 "다시 해봐" 금지. **무엇이 왜 문제이고 어떤 상태면 통과인지** 명시한
재작업 지시. 같은 지시 3회 반복 금지.

**2번이 이번 세션에서 가장 많이 값을 했다.** 위임이 통과 보고를 낸 수정이 원래
사건을 못 잡은 사례, 샌드박스 조건을 프로젝트 상태로 기록한 사례, YAML 파스를
워크플로 검증으로 보고한 사례가 전부 여기서 걸렸다.

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
| `inject` (PreToolUse) | 연결됨 (`.claude/settings.json`) |
| `guard` | **실사용 발화 확인** — 기각 3건이 실제 제안에서 잡혔다 |
| MCP | **확인됨** — `serverInfo: commitlore 0.1.0`, 도구 3개 응답 |
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

### 거부 픽스처 — 검증기가 반드시 막아야 하는 값

`spec/fixtures/invalid/` 의 실제 값이다. 파서를 손대면 이것들이 여전히 거부되는지
먼저 본다.

| 픽스처 | 값 | 위반 |
|---|---|---|
| `01-enum-blast` | `Blast: wide` | enum — `local\|module\|system` 만 |
| `02-format-ruled-out-no-pipe` | `Ruled-out: pointless without a pipe separator` | format — `대안 \| 이유` 의 `\|` 누락 |
| `03-unknown-key` | `Constraint: must ship by friday…` | unknown-key — **은퇴한 구어휘다. 부활 금지** |

세 번째가 특히 중요하다. `Constraint:` 는 오리지널리티 결정으로 폐기된 이름이고,
픽스처는 그것이 되살아나지 않는지를 지킨다.

**자유 텍스트 키는 전부 인젝션 표면이다.** 스캐너는 배제 목록으로 동작한다 —
enum·id 형태·semver만 제외하고 나머지는 전부 스캔한다. 허용 목록이 이 버그를
만들었고, 새 키가 스캔되지 않는 쪽으로 실패하는 것이 위험한 방향이다.
