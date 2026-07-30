<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore: 코딩 에이전트는 저장소가 이미 뒤집은 결정을 되살려서는 안 된다.">
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="라이선스: MIT" src="https://img.shields.io/badge/license-MIT-3f6b52"></a>
  <a href="package.json"><img alt="Node.js 22 이상" src="https://img.shields.io/badge/Node.js-%3E%3D22-3f6b52"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>한국어</strong> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

# CommitLore

## 코딩 에이전트는 저장소가 이미 뒤집은 결정을 되살려서는 안 된다.

**AI 보조 코드베이스를 위한 Git-native 결정 권위.** CommitLore는 어떤 결정이 아직 유효하고 어떤 결정이 뒤집혔는지를 Git에서 직접 추적한다. 코딩 에이전트가 경로를 조회하면 현재 유효한 결정만 보인다.

호스팅 메모리 서비스도, 벤더 전용 채팅 기록도 없다. 저장소가 소유하고 함께 이동하는, 검토 가능한 결정 맥락만 있다.

한 번 설치한다. 코딩 에이전트가 계속 가져갈 가치가 있는 결정을 기록할 수 있고, CommitLore는 이를 검증해 Git에 보존한다.

**Claude Code** — 플러그인 하나가 MCP 서버, 편집 전 컨텍스트 훅, 스킬을 함께 등록한다:

```
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

플러그인 경로의 전제 조건: Node.js 22+ 와 Git.

**그 밖의 코딩 에이전트** — CLI를 설치한다:

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v0.4.1/install.sh | sh
```


## 실제로 보기

<p align="center">
  <img src="./assets/readme/commitlore-demo.svg" width="100%" alt="commitlore demo: lifecycle filtering shows only active decisions">
</p>

**새 에이전트, 채팅 이력은 0개. 그래도 뻔한 수정안이 왜 제외됐는지 안다.** 바꾸기 전에 path를 조회한다.

```bash
commitlore context install.sh
```

출력에는 installer 결함의 수정안으로 `-musl` target을 배포하는 방안을 제외한 활성 record와 그 이유가 들어 있다. hook은 맥락을 제공하며, 편집을 막는다고 주장하지 않는다.

```console
context for install.sh as of <timestamp> — 0 limits, 1 ruled-out, 1 warnings, 2 other in 1 record (no index, 1 commit record(s) scanned)

ruled-out
  r-instci99a  <commit>  [claim]  Publish a -musl release target | a release.yml/build-matrix change, not an install.sh or CI-verification fix

warnings
  r-instci99a  <commit>  [claim]  Revisit this wording if a musl target ships
```

<details>
<summary>정확한 PreToolUse hook path 재현하기</summary>

```bash
printf '%s\n' '{"tool_name":"Edit","tool_input":{"file_path":"install.sh"}}' \
  | node dist/commitlore.mjs inject --hook-input --budget 5000
```

</details>

## 검색은 레코드를 찾을 수 있습니다. 경로 범위는 뒤집힌 결정을 걸러냅니다.

레코드 하나를 놓치면 모델은 맥락을 잃습니다. 이미 뒤집힌 결정을 건네면 정확성을 잃습니다. 이 [검색 측정](bench/retrieval/result.md)에서 방해 레코드가 0개부터 10,000개까지인 모든 크기에서 BM25, 임베딩 top-k, 하이브리드 RRF, 경로 필터를 적용한 임베딩은 각각 대체되어 폐기된 레코드 하나를 반환했습니다. 수명 주기를 적용한 CommitLore 경로 범위는 오래된 레코드를 0개 반환하고 현재 레코드 둘(2/2)을 모두 반환했습니다.

재현율은 보조 결과입니다. 검색은 대체로 어느 쪽이든 같은 레코드를 찾지만, 현재 유효한 결정을 아는 경로는 하나뿐입니다. 대체되어 폐기된 레코드가 없던 #166의 코퍼스에서는 임베딩 검색이 경로 범위와 같은 2/2를 기록했습니다. 결정이 뒤집혔을 때 차이가 나타나며, 바로 이 경우를 위해 이 제품이 존재합니다.

별도의 #167 노출 실행도 중요합니다. 10,002개 레코드 중 모델에 닿은 것은 2개뿐입니다.

| 경로 | 모델에 보인 레코드 | 관련 레코드 | 모델에 보인 토큰 |
|---|---:|---:|---:|
| 모두 주입 | 10,002 | 2/2 | 1,004,554 |
| top-k 어휘 검색 | 2 | 1/2 | 190 |
| CommitLore 경로 범위 | 2 | 2/2 | 335 |

이는 고정된 두 레코드 출력 예산에서 노출과 재현율을 측정한 것이며, 토큰 비용, 청구 비용, 정확도 또는 에이전트 행동을 측정하지 않습니다. 코퍼스 하나, 쿼리 하나, 고정된 임베딩 모델 하나의 결과입니다.

검증 훅과 로컬 인덱스를 쓸 각 저장소에서 이어서 `commitlore init`을 실행한다. 설치기는 지원되는 코딩 에이전트를 감지하고, 안전하게 가능한 곳에 로컬 MCP 서버를 등록한다.

## init 뒤에 일어나는 일

- 평소처럼 커밋한다. 대부분의 커밋에는 record가 없다.
- record가 있으면 commit-msg hook이 검증한다. record를 만들지는 않는다.
- 에이전트는 MCP로 결정 맥락을 조회하거나 `PreToolUse` hook으로 받는다.
- path를 바꾸기 전에 active limit, ruled-out alternative, warning, verification gap을 본다.

## 저장소에서 사용해 보기

```bash
cd your-repository
commitlore init
commitlore context .
```

그다음에도 코딩 에이전트와 계속 작업한다. 변경에 diff가 보존할 수 없는 결정 맥락이 있으면, 에이전트에게 커밋에 CommitLore record를 넣어 달라고 요청한다.

<details>
<summary>설치 내용을 살펴보거나 버전을 고정하고 싶나요?</summary>

한 줄 명령은 편의를 위한 것이다. 검토하거나 고정한 설치가 필요하면 먼저 `install.sh`를 내려받아 살펴보거나, 저장소를 clone하거나, 릴리스 자산을 직접 내려받아 `SHA256SUMS`를 검증한다. 스크립트는 내려받는 바이너리의 체크섬을 검증하지만, 이미 `sh`로 전달한 스크립트를 인증하지는 않는다.

```bash
# 설치기를 고정해 내려받고 살펴본 뒤 실행한다.
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v0.4.1/install.sh
sh install.sh v0.4.1

# 또는 릴리스 바이너리를 직접 검증한 뒤 압축을 푼다.
version=0.4.1; target=aarch64-apple-darwin
curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/commitlore-$version-$target.tar.gz"
curl -fsSLO "https://github.com/MongLong0214/commitlore/releases/download/v$version/SHA256SUMS"
grep "commitlore-$version-$target.tar.gz" SHA256SUMS | shasum -a 256 -c - # Linux: sha256sum -c -
```

</details>

## 무엇이 다른가

- **CLAUDE.md는 에이전트에게 어떻게 일할지 알려준다. CommitLore는 이 코드가 왜 존재하는지 알려준다.**
- **ADR은 아키텍처를 문서화한다. CommitLore는 diff 안에 숨은 결정을 문서화한다.**
- **또 하나의 메모리 데이터베이스가 아니다. Git에 들어가는 결정 프로토콜이다.**

권위 있는 원본은 평범한 commit trailer와 `refs/notes/commitlore`다. 인덱스와 보고서는 이 Git 기록에서 파생되며 다시 만들 수 있다.

## record가 만들어지는 방법

모든 커밋에 trailer를 손으로 쓸 필요는 없다. 대부분의 커밋에는 record가 없어야 한다. 외부 제약, 제외한 대안, 경고, 검증 공백처럼 diff만으로 복구할 수 없는 결정에만 record를 추가한다.

### 코딩 에이전트를 통해

에이전트에게 평소대로 커밋하고 diff로 설명할 수 없는 결정 맥락만 보존하도록 요청한다.

> 이 변경을 커밋해. diff로 중요한 제약, 제외한 대안, 경고 또는 검증 공백을 복구할 수 없을 때만 CommitLore record를 추가해.

대부분의 커밋에는 여전히 record가 없어야 한다. 에이전트 지침은 `skills/commitlore-commits/`에 있고, commit hook은 에이전트가 추가한 record를 검증한다.

### 고급 경로: harvest

`commitlore harvest`는 session transcript와 staged diff에서 prompt contract를 만들고, `commitlore harvest-verify`는 그에 맞는 draft를 검증한다. 둘은 draft를 돕지만 자동 커밋하지 않는다. interactive record builder는 구현되지 않았다.

### 직접 작성

탈출구로 사람이 평범한 Git trailer를 직접 쓸 수 있다. commit-msg hook은 이미 있는 record를 검증할 뿐이며, record를 발명하거나 조용히 추가하지 않는다.

## 최소 record

record는 작을 수 있다. 그렇지 않으면 잃게 될 맥락만 넣는다.

```text
Fix expired-token refresh

Ruled-out: Extend token TTL to 24h | security policy violation
Warn: Do not narrow the 4xx handler without verifying upstream behavior
```

대부분의 record에는 모든 protocol field가 필요하지 않다. 결정에 필요할 때 identity, lifecycle, risk, provenance, verification field를 사용할 수 있다.

## 완전한 record

이 예시는 conformance fixture이기도 하다. Git trailer parser는 모든 번역 README에서 아래 code block을 동일하게 읽는다.

```text
Prevent silent session drops during long-running operations

The auth service returns inconsistent status codes on token
expiry, so the interceptor catches all 4xx responses and
triggers an inline refresh.

Limit: Auth service does not support token introspection
Record-Id: r-4b7e21
Ruled-out: Extend token TTL to 24h | security policy violation
Ruled-out: Background refresh on timer | race condition
Certainty: firm
Blast: module
Undo: easy
Warn: 4xx handling is intentionally broad
  -- do not narrow without verifying upstream behavior
Verified: Single expired token refresh (unit)
Unverified: Auth service cold-start > 500ms behavior
CommitLore-Version: 2.0.0
```

### 프로토콜 어휘

| Trailer | Meaning |
|---|---|
| `Limit:` | External condition that constrained the decision |
| `Record-Id:` | Stable identity across rewritten commit hashes |
| `Ruled-out:` | `alternative \| reason` |
| `Certainty:` | `firm` \| `tentative` \| `guess` |
| `Blast:` | `local` \| `module` \| `system` |
| `Undo:` | `easy` \| `costly` \| `permanent` |
| `Warn:` | Warning for a future modifier; trust-graded before delivery |
| `Verified:` / `Unverified:` | What was and was not checked |
| `Follows:` / `Supersedes:` | Decision-chain and lifecycle links |
| `Expires:` | Date or condition that ends a limit |
| `Evidence:` | Path, anchor, or URL supporting a claim |
| `Provenance:` | `authored` \| `inherited <sha>` \| `reconstructed` |
| `CommitLore-Version:` / `X-*:` | Protocol identity and extensions |

경로의 이력을 `commitlore context <path>`로 읽거나 Git을 직접 쓴다.

```bash
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

텍스트 검색 대신 Git trailer parser를 쓴다. 본문에 있는 `Key:`는 trailer가 아닐 수 있다.

## 저장소가 증명하는 것

- 테스트한 Git workflow에서 결정 이력은 rebase, squash, remote transfer, 경로 rename을 거쳐도 유지된다.
- 모든 route는 같은 trust grading을 써서 신뢰하지 않는 텍스트를 지시가 아닌 정보로 전달한다.
- 자유 형식 trailer의 injection 같은 텍스트는 model-readable route에서 보류된다.
- 읽을 수 있는 저장소의 기록 없음은 불완전한 history나 fetch하지 않은 notes mirror와 구별된다.

이것은 Git에 묶여 사람이 검증할 수 있는 결정 이력에 대한 제품 주장이다. CommitLore가 에이전트 성능을 높인다는 주장에 기대지 않는다.

## 근거: 더 좁은 제품 주장

112회 실험은 기록됐지만 M4에는 run별 `guard_exposure` 기록이 없다. treatment가 있었는지 검증할 수 없으므로 agent behavior 주장을 시험하거나 뒷받침하거나 반박하지 못한다. 위의 더 좁은 제품 주장은 독립적으로 검증 가능한 동작에 근거한다. 깨끗한 데이터셋과 철회 내용은 [M4 verdict](bench/VERDICT-M4.md)에서 읽을 수 있다.

### 지연 시간, 비용과 손익분기점

100,000개 커밋에서 색인된 `context`의 p50은 496 ms이고 CommitLore 자체의 `--no-index` 대체 경로는 86,673 ms다. 이 내부 대체 경로 간격은 1k에서 4.8×, 10k에서 36×, 100k에서 175×로 커진다([전체 결정론적 실행](https://github.com/MongLong0214/commitlore/blob/2fade893f25917fce1ffb497aab96b1eb271a185/bench/results/deterministic-20260729T032652Z.md)). 이는 확장 양상이며 제품과 대안을 비교한 결과가 아니다.

guard가 한 번 실행될 때 드는 비용은 주입된 context와 측정된 hook 오버헤드다. commit-msg는 p50 185.85 ms, injection hook은 p50 102.40 ms다([deterministic measurements](bench/results/deterministic-20260727T174801Z.md)).

손익분기 수치를 다시 제시하려면 제공업체가 보고한 턴별 토큰 사용량 원장과 저장소가 이미 배제한 대안에 쓴 작업의 관측된 비용이 필요하다.

<details>
<summary>전체 benchmark 기록 (112회 실험)</summary>

<!-- BENCH:BEGIN -->
<!-- Generated by `node bench/report.ts --section` from the result logs named below. Do not edit by hand:
     CI regenerates this block and fails if a single byte differs (scripts/check-readme-numbers.mjs). -->

**112 runs recorded.** No manifest declares how many runs the matrix was meant to produce, so completeness cannot be checked from the logs alone.

| Where it comes from | |
|---|---|
| Results | `bench/results/t702-m4-final.jsonl` (112 rows) |
| Run id | `20260727T120103Z-aa5eab`, `20260728T025523Z-db4659`, `20260728T025635Z-e3d669`, `20260728T025817Z-d8d0dc` |
| Driver | `claude-headless` |
| Model | not recorded |
| Matrix | 8 tasks, seeds 1, 2, 3, 4, 5, 6, 7 |
| Status | final (declared in `bench/report.ts`, pending a manifest field) |

**Re-proposal and violation rates, every recorded run:**

| Condition | n | Re-proposed | Re-proposal rate | Runs with violations | Violation rate | Mean turns | Mean tokens |
|---|---|---|---|---|---|---|---|
| `commitlore-guard` | 56 | 41 | 0.732 | 0 | 0.000 | 14.8 | 18965 |
| `commitlore-on` | 56 | 35 | 0.625 | 0 | 0.000 | 14.2 | 18091 |

**Analysis set — all 112 rows.** Nothing was excluded: no simulated rows, no failed runs, no run that never started.

**Significance:** not computed — guard exposure is unknown for 112 analysis rows

**How the runs ended** — failures are reported, not filtered:

| Condition | completed | timeout | over-turns | over-tokens | error |
|---|---|---|---|---|---|
| `commitlore-guard` | 56 | 0 | 0 | 0 | 0 |
| `commitlore-on` | 55 | 0 | 1 | 0 | 0 |

**Read these numbers with their limits:**

- No model is recorded — neither on the rows nor in a manifest. A re-proposal rate whose model is unknown is not a comparable number, and these figures must not be quoted against another model's.
- Every rate here is conditional on the model that produced it. Re-proposal is a behaviour, and behaviours differ between models, so these figures are not evidence about any other model.
- 112 runs in the analysis set: this matrix is only powered to detect a large effect, so a non-significant result from it is a statement about the sample size, not about CommitLore. The exact power table is in [`bench/README.md`](bench/README.md).
<!-- BENCH:END -->

</details>

## 소스에서 설치

소스 배포를 살펴보거나 실행하려면 다음을 쓴다.

```bash
git clone https://github.com/MongLong0214/commitlore ~/.commitlore
node ~/.commitlore/dist/commitlore.mjs init
node ~/.commitlore/dist/commitlore.mjs context src/auth
```

## 알려진 제한 사항

- Windows는 지원하지 않는다: [#95](https://github.com/MongLong0214/commitlore/issues/95).
- Alpine 및 다른 musl Linux host는 지원하지 않는다: [#99](https://github.com/MongLong0214/commitlore/issues/99).
- 암호학적 작성자 검증, 저장소 전체 record coverage, symbol anchor, interactive record builder는 아직 구현되지 않았다: [#28](https://github.com/MongLong0214/commitlore/issues/28), [#32](https://github.com/MongLong0214/commitlore/issues/32), [#33](https://github.com/MongLong0214/commitlore/issues/33), [#34](https://github.com/MongLong0214/commitlore/issues/34).
- M4는 guard 효과를 시험하지 못했다. row에 `guard_exposure`가 없어 treatment exposure를 검증할 수 없다: [#122](https://github.com/MongLong0214/commitlore/issues/122).
- Guard(ruled-out alternative matching)는 실험적 참고 자료이다: precision 44.8%(95% Wilson CI 32.7%–57.5%), recall 22.0%, 417-decision corpus 기준([ADR-0020](docs/adr/ADR-0020-guard-is-an-experimental-advisory.md)). 빈 guard 결과는 제안이 모든 ruled-out alternative를 피했다는 보장이 아니다 — recall 22%에서 누락이 일반적이다.

## 기여하기

[spec](spec/SPEC.md), [ADR](docs/adr/), [`CONTRIBUTING.md`](CONTRIBUTING.md)를 읽어보라. CommitLore는 [MIT License](LICENSE) 아래에서 영원히 무료인 오픈소스다.
