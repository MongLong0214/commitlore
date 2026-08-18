<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore는 저장소의 결정 권위를 다음 편집으로 나른다: src/pricing.ts에서 아직 유효한 결정이 그것이 기각한 대안과 함께 전달되고, 대체된 이전의 더 넓은 limit은 현재 지침으로 넘어가지 않는다.">
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="라이선스: MIT" src="https://img.shields.io/badge/license-MIT-3f6b52"></a>
  <a href="package.json"><img alt="Node.js 22.23.2 이상" src="https://img.shields.io/badge/Node.js-%3E%3D22.23.2-3f6b52"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>한국어</strong> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

# CommitLore

**코딩 에이전트가 팀에서 이미 기각한 방안을 계속 다시 제안합니다.**

CommitLore는 그런 결정을 Git에 보관하고, 파일을 편집하기 전에 아직 유효한 결정만
에이전트에게 전달합니다.

CommitLore에는 호스팅 서비스가 없고 record를 Git에 보관합니다. MCP 서버나 hook이
맥락을 반환한 뒤에는 host가 자신의 정책에 따라 그 맥락을 처리합니다. CommitLore는 그
데이터 흐름을 제어하지 않습니다.

**두 절반이 있고, 자동인 것은 하나입니다.** *delivery*, 곧 에이전트가 경로를 편집하기
전에 아직 유효한 결정을 건네주는 일은 설치하면 알아서 됩니다. *capture*, 곧 새
결정을 기록하는 일은 변경에 diff가 보여줄 수 없는 이유가 있을 때 에이전트가
합니다. 평범한 `git commit`은 이것을 시작할 수 없습니다. hook에는 diff가 있고
capture에는 세션이 필요하기 때문입니다.

<details>
<summary><strong>목차</strong></summary>

- [설치](#설치)
- [에이전트가 받는 것](#실제로-보기)
- [자동으로 되는 것과 아닌 것](#자동으로-되는-것과-아닌-것)
- [도움이 되지 않는 경우](#이것이-도움이-되지-않는-경우)
- [한 가지 예로 보는 문제](#코드는-남았다-결정은-남지-않았다)
- [CommitLore란 무엇인가](#commitlore를-자세히-보면)
- [경로 질의 보기](#경로-질의-보기)
- [이 저장소 자체가 데모](#이-저장소-자체가-데모입니다)
- [경로 범위와 검색](#검색은-레코드를-찾을-수-있습니다-경로-범위는-뒤집힌-결정을-걸러냅니다)
- [동작 방식](#어떻게-동작하나)
- [다른 저장소의 현장 보고](#실제-저장소에서는-이렇게-보인다)
- [차이점](#무엇이-다른가)
- [효과가 있는 곳](#어디서-값을-하나)
- [record 생성 방식](#record가-만들어지는-방법)
- [완전한 record](#완전한-record)
- [저장소가 증명하는 것](#저장소가-증명하는-것)
- [근거](#근거-더-좁은-제품-주장)
- [제거](#제거) · [문서](#문서) · [기여하기](#기여하기)

</details>

## 설치

한 번 설치한다. host integration을 설치하고, 사용할 저장소를 초기화한다.

**Claude Code** — 플러그인 하나가 MCP 서버, 편집 전 컨텍스트 훅, 스킬을 함께 등록한다:

```
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

플러그인이 담는 것은 여기까지다: MCP 서버, 편집 전 훅, 스킬. `commitlore`를 `PATH`에 올리지는 않으므로, 아래의 `commitlore …` 명령은 `install.sh` / `install.ps1`에서 오고 그 설치까지 필요하다.

**Codex** — 네이티브 플러그인은 한 명령으로 설치한다:

```bash
commitlore plugin install-codex
```

Codex의 자체 CLI로 marketplace와 plugin을 등록한다. 설정이나 cache를 직접 고치지 않는다. 아래의 표준 설치 스크립트도 Codex를 감지하면 같은 명령을 실행한다. 설치 뒤에는 새 Codex session을 시작한다 — plugin의 skill과 MCP server는 설치 시점이 아니라 session 시작 시점에 로드된다. 아래 CLI가 repository command를 제공한다.

두 경로 모두의 전제 조건: Node.js 22.23.2+ 와 Git. 스크립트는 무엇이든 쓰기 전에 둘을 확인한다.

**그 밖의 코딩 에이전트** — CLI를 설치한다:

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.1.3/install.sh | sh -s v1.1.3
```

**Windows** — PowerShell에서 같은 설치를 한다:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/MongLong0214/commitlore/v1.1.3/install.ps1))) v1.1.3
```

Windows에서 host 배선은 **v1.1.1 이상**이 필요하다. 그 전에는 탐지가 `.cmd` shim을 보지 못하고 설치기가 그것을 실행하지도 못해서, Windows 설치는 CLI만 놓고 아무것도 배선하지 않았다 — 성공이 아니라 `ok: false`로 보고됐다. 1.1.1에서 Codex, Gemini CLI, Hermes에 대해 실기로 확인했다.

**Hermes** — CLI를 설치한 뒤 host integration을 설정한다:

```bash
commitlore hermes install
```

어떤 host를 지원하는지, 각 설치 경로가 무엇을 요구하는지: [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

**지난 에이전트가 얻어낸 판단을, 다음 에이전트에게 물려주세요.**

### 그런 다음, 각 저장소에서

검증 훅, 로컬 인덱스, 저장소 소유 agent procedure를 쓸 각 저장소에서 이어서
`commitlore init`을 실행한다. 설치기는 지원되는 코딩 에이전트를 감지하고,
안전하게 가능한 곳에 로컬 MCP 서버를 등록한다.

```bash
cd your-repository
commitlore init
commitlore context .
```

그다음에는:

- 평소처럼 커밋한다. 대부분의 커밋에는 record가 없다.
- record가 있으면 commit-msg hook이 검증한다. record를 만들지는 않는다.
- delivery와 capture는 다른 layer다. 다음 섹션에서 host별 두 layer를 정확히 설명한다.

코딩 에이전트와 계속 작업한다. 변경에 diff가 보존할 수 없는 결정 맥락이 있으면, 에이전트에게 커밋에 CommitLore record를 넣어 달라고 요청한다.

<details>
<summary>설치 내용을 살펴보거나 버전을 고정하고 싶나요?</summary>

한 줄 명령은 편의를 위한 것이다. 검토하거나 고정한 설치가 필요하면 먼저 `install.sh`를 내려받아 살펴보거나, 저장소를 clone한다. 스크립트는 고정된 태그의 소스 체크아웃과 `node <checkout>/dist/commitlore.mjs`를 실행하는 얇은 wrapper만 설치한다 — 컴파일된 산출물을 내려받지 않고 빌드 단계도 없으므로, 기계에 놓이는 것은 읽을 수 있는 소스다.

```bash
# 설치기를 고정해 내려받고 살펴본 뒤 실행한다.
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v1.1.3/install.sh
sh install.sh v1.1.3

# 또는 스크립트를 건너뛴다. 스크립트가 만드는 체크아웃은 직접 만들 수 있는 것과 같다.
git clone --depth 1 --branch v1.1.3 https://github.com/MongLong0214/commitlore
node commitlore/dist/commitlore.mjs --version
```

</details>

### 업그레이드

설치 스크립트를 다시 실행하고, 에이전트 세션을 새로 시작한다.

훅은 설치 시점에 쓰인 파일이라 세대가 셋이다. **v1.0.2 이전**에 설치된 훅은 릴리스 하나를 직접 가리킨다. **v1.0.2 ~ v1.1.2**에 설치된 훅은 `current`를 따라가지만, 그 시절 격리 stub이 통상 업그레이드를 알아보지 못해 git이 훅에 주는 `PATH`에서 커밋을 거부한다. **v1.1.3 이후**에 설치된 훅은 통상 업그레이드를 알아서 따라간다.

앞의 두 세대는 저장소마다 한 번씩 아래를 실행해야 한다.

```bash
commitlore hooks install
commitlore doctor
```

설치 프로그램은 이걸 대신 못 한다. 어느 저장소에 훅이 있는지 알 방법이 없고, 저장소의 `.git`을 건드리지 않는 것은 누락이 아니라 정책이다. 실행 중인 세션은 시작할 때 읽은 런타임을 그대로 들고 있으므로 재시작이 따로 필요하다.

## 실제로 보기

`src/pricing.ts`를 편집하기 전에 에이전트는 설명이 아니라 record 자체인 이 payload를 받는다:

```
commitlore: active records for src/pricing.ts

Limit
  [claim]      r-price01  87e36511  calculatePrice owns final checkout pricing only

Ruled-out
  [claim]      r-price01  87e36511  Reuse checkout pricing for admin quotes | eligibility
                                    and rounding semantics differ between the two flows
```

`[claim]`에는 의미가 있다. 이 record의 작성자 문자열이 저장소가 directive용으로
설정한 문자열과 일치하지 않으므로, 에이전트는 명령이 아니라 정보로 평가해야 한다.
기본 author-string 모드에서 `[directive]`는 저장소가 그 문자열을 제약으로 취급하기로
정했다는 뜻일 뿐 신원 증명은 아니다. commit 작성자가 문자열을 고르므로 commit을 쓸 수
있는 누구나 위조할 수 있다. `commitlore.requireSignedDirective=true`를 설정하면 Git이
검증자의 trust store에 대해 확인한 서명이 있어야 하고, Git이 보고한 `%GF` 지문이
repository-local `commitlore.trustedSigner` allowlist에 있어야 한다. allowlist가 없거나 비어 있거나 읽을 수
없으면 누구도 권한을 얻지 않는다. 그 서명 역시 권한이나 record의 진실을 증명하지는 않는다.
delivery는 맥락을 준다. 편집을 막지는 않는다.

## 자동으로 되는 것과 아닌 것

**Delivery**는 path를 편집하기 전에 record가 에이전트에 도달한다는 뜻이다.
**Capture**는 결정이 검증된 commit-time flow에 들어갈 수 있다는 뜻이다. 둘은 다른 layer다:

| Host | Delivery | Capture |
|---|---|---|
| Claude Code | **예 — plugin을 통해 자동으로 된다.** | **예 — plugin을 통해 된다.** |
| Codex | **예 — plugin을 통해 자동으로 된다.** | **예 — plugin을 통해 된다.** |
| Hermes | **예 — `commitlore hermes install`.** | **예 — `commitlore hermes install`.** |
| Gemini CLI, Cursor, Windsurf, opencode | **된다 — 두 설치기 모두 MCP server를 배선한다.** 각자가 아니라 공유된 한 단계를 거친다. | **procedure이며 자동이 아니다.** server가 연결마다 prepare → verify → stage 절차를 알린다. host가 따를 수도, 따르지 않을 수도 있다. |
| 그 밖의 `AGENTS.md` convention host | **procedure이며 자동이 아니다.** `commitlore init --agents-md`가 저장소에 적는다. | **procedure이며 자동이 아니다.** 같은 파일, 같은 단서. |

“예”는 layer가 설치되었다는 뜻이지 모든 commit에 record가 생긴다는 뜻이 아니다.
대부분의 commit에는 record가 없어야 한다. 자동 integration은 첫 세 행에만 있다. 다른
`AGENTS.md` host에서는 두 단계 모두 hook이 아니라 instruction이다. host가 capture를
시작해야 하고, candidate는 commit hook이 붙이기 전에 검증을 통과해야 한다. commit-msg
hook은 record가 있으면 검증하지만, 새로 만들지는 않는다.



## 이것이 도움이 되지 않는 경우

설치하기 전에 읽어보세요.

- **측정된 것은 약한 쪽 등급이다.** 1,160회 연구에서 모든 레코드는 `[claim]`으로
  렌더링되었고, 이는 에이전트에게 명령이 아니라 정보로 다루라고 말한다.
  `[directive]` 등급은 그 뒤에야 도달 가능해졌고 여기서 측정되지 않았다 —
  연구 자신의 판정문이 이 수치는 "강한 쪽으로 전이되지 않는다"고 적는다.
  directive가 더 나은지 못한지 같은지는 **양방향 모두 측정되지 않았다**.
- **모델 하나, 하니스 하나, 구성된 픽스처 열 개다.** 오라클은 최종 구현
  상태를 읽는다. 따라서 레코드를 받은 에이전트가 배제된 접근을 덜 제안했다는
  것은 보여주지만, 그중 누군가가 무언가를 읽었다는 것은 보여주지 않는다.
- 암호학적 작성자 검증, 저장소 전체 record coverage, symbol anchor, interactive record builder는 아직 구현되지 않았다: [#28](https://github.com/MongLong0214/commitlore/issues/28), [#32](https://github.com/MongLong0214/commitlore/issues/32), [#33](https://github.com/MongLong0214/commitlore/issues/33), [#34](https://github.com/MongLong0214/commitlore/issues/34).
- M4는 guard 효과를 시험하지 못했다. row에 `guard_exposure`가 없어 treatment exposure를 검증할 수 없다: [#122](https://github.com/MongLong0214/commitlore/issues/122).
- Guard(ruled-out alternative matching)는 실험적 참고 자료이다: precision 44.8%(95% Wilson CI 32.7%–57.5%), recall 22.0%, 417-decision corpus 기준([ADR-0020](docs/adr/ADR-0020-guard-is-an-experimental-advisory.md)). 빈 guard 결과는 제안이 모든 ruled-out alternative를 피했다는 보장이 아니다 — recall 22%에서 누락이 일반적이다.

전체 방법, 제외 항목, arm별 truncation split은 [bench/VERDICT-M5.md](bench/VERDICT-M5.md)와
[보여 주지 않는 것](docs/evidence.md)에 있다. delivery 방법과 retrieval 근거는
[bench/DECISION-DELIVERY.md](bench/DECISION-DELIVERY.md)에 있다.

## 코드는 남았다. 결정은 남지 않았다.

*같은 나쁜 아이디어를 다시 리뷰하지 않는다.*

**CommitLore 없이.** 새 세션이 입력이 비슷한 함수 둘을 보고 하나를 재사용한다.

```ts
calculatePrice(input, { isAdminPreview: true, skipCoupon: true });
```

이제 팀에는 flag 하나, wrapper 하나, compatibility branch 하나가 더 생겼다. 그 branch가
지키는 사용처는 애초에 그 함수가 맡을 생각이 없던 것이다. 리뷰어는 "이건 이미 기각했다"를 두 번째로 쓴다.

**CommitLore와 함께.** 편집 전에 에이전트는 위에 보인 active record를 받아,
리뷰 코멘트에서 재구성한 지시를 받지 않는다.

모듈 경계가 리뷰 코멘트로 뒤늦게가 아니라, 에이전트가 변경을 제안하기 **전에** 그 앞에
놓인다.

등록된 실행 1,160회에서 이는 기각된 방안을 다시 제안하는 비율을 **18.8%**에서
**2.8%**로 낮췄다. 이 수치가 보여 주지 않는 것은 위의
[이것이 도움이 되지 않는 경우](#이것이-도움이-되지-않는-경우)에 있다.

## CommitLore를 자세히 보면

**코딩 에이전트를 위한 Git 네이티브 decision layer.**

새 에이전트는 구현을 물려받는다. 하지만 제약도, 팀이 기각한 대안도, 경고도, 검증 공백도
물려받지 못한다 — 무언가가 실어 나르지 않는 한 코드와 함께 이동하지 않는다.

CommitLore는 그 엔지니어링 판단을 Git에 보존하고, 다음 편집 전에 **지금도 유효한 결정만**
전달한다. 이후 대체되거나 만료된 결정은 여전히 유효한 것처럼 에이전트에게 도달하지
않는다.

**저장소 소유 · lifecycle 인식 · 근거 검증 · 에이전트 비종속**

Claude Code · Codex · Cursor · Gemini CLI · OpenCode · Windsurf

호스팅 메모리 서비스도, 벤더 전용 채팅 기록도 없다. 저장소가 소유하는, 검토 가능한
결정 맥락만 있다. commit trailer는 commit과 함께 이동하지만 notes-backed record는
ordinary clone에 오지 않는다. Git은 기본으로 `refs/notes/*`를 fetch하지 않으므로,
clone 뒤 notes fetch를 구성해야 한다.

## 경로 질의 보기



**새 에이전트, 채팅 이력은 0개. 그래도 뻔한 수정안이 왜 제외됐는지를 건네받는다.** 바꾸기 전에 path를 조회한다.

```bash
commitlore context install.sh
```

출력에는 installer 결함의 수정안으로 `-musl` target을 배포하는 방안을 제외한 활성 record와 그 이유가 들어 있다. hook은 맥락을 제공한다. 편집을 막는다고 주장하지는 않는다.

```console
context for install.sh as of <timestamp> — 0 limits, 1 ruled-out, 1 warnings, 2 other in 1 record (no index, 1 commit record(s) scanned)

ruled-out
  r-instci99a  <commit>  [claim]  Publish a -musl release target | a release.yml/build-matrix change, not an install.sh or CI-verification fix

warnings
  r-instci99a  <commit>  [claim]  Revisit this wording if a musl target ships
```

이 PreToolUse hook path를 그대로 재현하는 방법과 나머지 모든 명령은 [docs/cli.md](docs/cli.md)에 있다.

## 이 저장소 자체가 데모입니다

이미 결론 난 질문을 에이전트가 다시 결정하지 못하게 한다고 주장하는 도구라면, 스스로에게서 무엇을 잡아냈는지도 보여줄 수 있어야 한다. 이 도구는 그 목록을 공개로 유지한다. 이 프로젝트가 이미 공개한 내용 중 나중에 틀렸음이 밝혀진 것들도 포함한다.

- **어떤 설치도 README의 주장이 근거한 신뢰 등급을 만들 수 없었다.** record는 에이전트에게 `directive` 또는 `claim` 등급으로 전달된다. 설치된 어느 표면도 신뢰된 작성자를 구성하지 않았으므로, 등급은 모두 `claim`으로 fail-closed 되었지만 주입된 범례는 누구도 도달할 수 없는 등급을 알리고 있었다. 두 이전 benchmark는 `claim` 등급 전달을 측정했다 ([#415](https://github.com/MongLong0214/commitlore/issues/415)).
- **등록된 benchmark 분석은 한 번에 서로 다른 네 실험을 읽었을 것이며**, 중단 규칙이 행 수였기 때문에 그 오염은 연구가 자체 완전성 관문을 *통과*하게 만들었을 것이다 ([#441](https://github.com/MongLong0214/commitlore/issues/441)).
- **result-schema gate는 아무것도 실행하지 않았다.** 그래서 schema는 runner보다 다섯 필드 뒤처졌고 이틀 동안 아무도 알아차리지 못했다 ([#392](https://github.com/MongLong0214/commitlore/issues/392)).
- **배포된 pre-push hook은 모든 `git push`를 멈추게 했다.** 40초에 hook 호출 1,240회였다. 함수는 열한 번 시험했지만 hook path는 한 번도 시험하지 않았기 때문이다 ([#422](https://github.com/MongLong0214/commitlore/issues/422)).

이들 모두는 커밋 trailer의 `Ruled-out:`, `Warn:`, `Limit:` 줄이다. 이 프로젝트가 설치를 권하는 hook이 그 줄을 검증한다. 다른 곳에서 실행하는 것과 같은 `commitlore context`로 읽을 수 있다.

**각 항목이 치른 대가를 포함한 전체 목록: [docs/SELF-AUDIT.md](docs/SELF-AUDIT.md).**

## 검색은 레코드를 찾을 수 있습니다. 경로 범위는 뒤집힌 결정을 걸러냅니다.

에이전트가 첫 편집을 하기 전에, 저장소가 가진 아직 유효한 결정 중 실제로 몇 퍼센트가 에이전트에게 도달할까요? 이 저장소에서, 훅이 기본으로 쓰는 800토큰 예산 기준:

| 경로 | 예산 | 전달된 유효 결정 | 전달된 뒤집힌 결정 | 토큰 |
|---|---:|---:|---:|---:|
| 코드만 | — | 0.0% | 0 | 0 |
| 해당 경로의 `git log` | 800 | 42.0% | 7 | 673,134 |
| **CommitLore 경로 범위** | **800** | **81.7%** | **0** | **511,412** |
| CommitLore, 상한 해제 | 없음 | 92.3% | 0 | 741,429 |

상한을 풀면 경로 범위는 저장소 전체 덤프가 회수하는 것과 정확히 같은 2,217쌍 중 2,047쌍을 회수한다. 덤프의 92,175,612 토큰 중 일부만 쓰고, 덤프가 함께 실어 나르는 뒤집힌 레코드 7,322개는 하나도 전달하지 않는다. **범위는 아무 대가도 치르지 않는다.** 상한이 10.6포인트를 쓴다. 남은 170쌍은 신뢰 등급자가 보류한 레코드다.

**이것은 전달을 잰 것이지 효과를 잰 것이 아니다.** 에이전트를 돌리지 않았으므로 회수할 수 *있는* 양의 상한이지 실제로 회수하는 양이 아니다. 그리고 검색 지표는 예측해야 할 결과가 나빠지는 동안에도 올라갈 수 있다. SWE-bench는 컨텍스트 예산을 늘릴 때 BM25 recall이 29.58에서 51.06으로 오르는 것을 측정하고도, "BM25의 최대 컨텍스트 크기를 늘리면 oracle 파일에 대한 recall이 올라가는 경우에도 성능은 떨어진다 … 모델이 문제 코드를 국소화하는 데 그저 서툴기 때문"이라고 보고했다 ([arXiv:2310.06770](https://arxiv.org/abs/2310.06770)). 코퍼스 하나, 저장소 하나다. 대체된 레코드는 7개, 만료된 레코드는 0개이므로 "뒤집힌 결정 0건 전달"은 만료에 대해서는 아직 아무것도 말하지 않는다. 방법과 전체 표: [bench/DECISION-DELIVERY.md](bench/DECISION-DELIVERY.md).

**`git log` 기준선은 우리가 우리를 재서 나온 값이 아니다.** 같은 측정을 이 프로젝트가 쓰지 않은 저장소 넷(Django, SymPy, scikit-learn, Requests)에 고정 커밋으로 적용하면, 한 경로의 이력 중 800토큰 절단에서 살아남는 비율이 **37.4%에서 55.6%** 사이이다. 위의 42.0%가 그 구간 안에 들어간다. 고정 예산이 한 파일 이력의 절반 가까이를 잘라내는 것은 크고 오래된 저장소에서 `git log`가 일반적으로 하는 일이지, 이 저장소만의 특이점이 아니다. **이전되지 않은 것은 메커니즘이다.** 우리 경로는 중앙값 1커밋에 687토큰인데 Django는 8커밋에 213토큰이라, 긴 커밋 메시지가 고정 예산에서 평범한 Git 기준선을 더 나쁘게 만든다 — 이 프로젝트 자체 관행이 치르는 비용이다. [bench/EXTERNAL-CORPUS.md](bench/EXTERNAL-CORPUS.md)는 그 저장소들에 대한 전달 수치도 보고하지만 §9.0과 §9.5를 먼저 읽으십시오. 거기 레코드는 revert 커밋에서 프로그램이 생성한 것이고, 헤드라인 숫자는 검색 결과가 아니라 부착 술어가 강제하는 값이다.

레코드 하나를 놓치면 모델은 맥락을 잃는다. 이미 뒤집힌 결정을 건네면 정확성을 잃는다. 이 [검색 측정](bench/retrieval/result.md)에서 방해 레코드가 0개부터 10,000개까지인 모든 크기에서 BM25, 임베딩 top-k, 하이브리드 RRF, 경로 필터를 적용한 임베딩은 각각 대체되어 폐기된 레코드 하나를 반환했다. 수명 주기를 적용한 CommitLore 경로 범위는 오래된 레코드를 0개 반환하고 현재 레코드 둘(2/2)을 모두 반환했다.

재현율은 보조 결과다. 검색은 대체로 어느 쪽이든 같은 레코드를 찾지만, 현재 유효한 결정을 아는 경로는 하나뿐이다. 결정이 뒤집혔을 때 차이가 나타난다. 이 제품은 바로 그 경우를 위해 존재한다.

별도의 #167 노출 실행도 중요하다. 10,002개 레코드 중 모델에 닿은 것은 2개뿐이다.

| 경로 | 모델에 보인 레코드 | 관련 레코드 | 모델에 보인 토큰 |
|---|---:|---:|---:|
| 모두 주입 | 10,002 | 2/2 | 1,004,554 |
| top-k 어휘 검색 | 2 | 1/2 | 190 |
| CommitLore 경로 범위 | 2 | 2/2 | 335 |

이는 고정된 두 레코드 출력 예산에서 노출과 재현율을 측정한 것이다. 토큰 비용, 청구 비용, 정확도나 에이전트 행동은 측정하지 않는다. 코퍼스 하나, 쿼리 하나, 고정된 임베딩 모델 하나의 결과다. 재현율이 동률인 지점과 그 밖에 무엇이 측정됐고 무엇이 측정되지 않았는지는 [docs/evidence.md](docs/evidence.md)에 있다.

## 어떻게 동작하나

1. **Capture** — 에이전트가 diff로는 알 수 없는 결정 맥락만 초안으로 쓴다.
2. **Verify** — CommitLore가 그 초안을 세션과 staged diff에 대조한다.
3. **Preserve** — 검증된 record가 identity와 lifecycle을 갖고 Git에 남는다.
4. **Deliver** — 다음 에이전트는 경로를 편집하기 전에 **지금도 유효한 결정만** 받는다.

## 실제 저장소에서는 이렇게 보인다

커밋 약 768개인 Swift MCP 서버의 필드리포트에서, 설치 다음 날. 파일 경로 하나를 댔더니
엔지니어가 존재조차 몰랐던 merge된 PR이 나왔고, 남아 있던 코드의 의미가 달라졌다.

> **그 커밋이 있는 줄 몰랐다.** 2주 전 merge된 PR이고, 이미 이 사이트 여덟 곳을 제거하고
> 각각을 accessibility-native 등가물로 교체했다 — 전부 fail-closed에 실기기 검증까지.
>
> 이 중 어느 것도 채팅 기록에 없었다. 저장소에 있었고, 나는 파일 경로를 대서 얻었다.

대안은 2주치 merge된 PR을 읽는 것이었다. 에이전트가 자발적으로 하는 일이 아니고, 사람이
매 편집 전에 하는 일도 아니다. 같은 리포트의 도입 비용: 명령 하나, 그리고 커밋 768개
인덱싱에 7.4초. 히스토리도 작업 트리도 건드리지 않는다. 콘솔 출력과 리포트 전문은
[docs/evidence.md](docs/evidence.md)에 있다.

그건 커밋 768개짜리 저장소였다. **커밋 10만 개에서 인덱스를 쓴 `context` 질의는 p50
496 ms에 답한다.** 그 뒤에서 도는 훅은 `commit-msg`가 p50 185.85 ms, 주입 훅이 p50
102.40 ms다. 큰 저장소에 이걸 계속 설치해 둘지 결정하는 건 이 숫자들이고, 주장이 아니라
측정값이다. 같은 실행에는 보기 나쁜 숫자도 들어 있다. 인덱스 없이 같은 질의를 커밋 10만
개에서 하면 86,673 ms가 걸린다. 인덱스는 잘 도는 질의 위에 얹은 최적화가 아니라 그
규모에서 질의를 가능하게 만드는 것 자체이고, 그래서 `init`이 그것을 만들고 `doctor`가
그것을 확인한다.

**호스팅형 채팅 기록 제품이 줄 수 없는 세 가지**, 그리고 권위를 서비스가 아니라 Git에 둔 이유:

| 도구 | 기억하는 것 |
|---|---|
| `CLAUDE.md` / `AGENTS.md` | 에이전트가 어떻게 일해야 하는가 |
| ADR | 큰 아키텍처 결정을 문서로 |
| Chat memory / RAG | 과거의 관련 텍스트 |
| [Lore](https://arxiv.org/abs/2603.15566) | 같은 발상, 먼저 발표됨 — git trailer에 담은 결정 레코드 |
| **CommitLore** | **이 코드 경로에 지금도 유효한 결정** |

유사도 검색은 관련된 결정을 찾아줄 수 있다. CommitLore는 거기에 더해 그 결정이 아직
유효한지, 대체됐는지, 만료됐는지를 알고 — 첫 번째 것만 보여준다.

**세 번째 행에 대하여.** [Lore](https://arxiv.org/abs/2603.15566)(2026년 3월)는 이
저장소가 생기기 넉 달 전에 native git trailer에 결정 레코드를 담는 방식을 제안했고, 그
어휘는 이쪽과 거의 일대일로 대응한다. **프로토콜 발상은 여기서 새로운 것이 아니며**,
아니라고 말해봐야 논문을 읽는 사람 앞에서 버티지 못한다. Lore에 대응물이 없는 것은
lifecycle(`Supersedes:`와 `Expires:`, 그리고 위 표의 마지막 행을 참으로 만드는 필터링)과
신뢰 등급이고, 논문 자신은 "empirical validation path를 *제시한다*"고 쓴다. 실행하지는
않는다. 그 검증을 실패한 부분까지 포함해 가진 것이 이 프로젝트가 논문보다 가진 것이다
([ADR-0029](docs/adr/ADR-0029-lore-is-prior-art-and-this-is-what-differs.md)).

## 무엇이 다른가

- **CLAUDE.md는 에이전트에게 어떻게 일할지 알려준다. CommitLore는 이 코드가 왜 존재하는지 알려준다.**
- **ADR은 아키텍처를 문서화한다. CommitLore는 diff 안에 숨은 결정을 문서화한다.**
- **또 하나의 메모리 데이터베이스가 아니다. Git에 들어가는 결정 프로토콜이다.**

권위 있는 원본은 평범한 commit trailer와 `refs/notes/commitlore`다. 인덱스와 보고서는 이 Git 기록에서 파생되며 다시 만들 수 있다.

## 어디서 값을 하나

**모듈 경계를 지킨다.** *"`calculatePrice`는 최종 checkout 가격만 담당한다. 관리자 미리보기에 재사용하지 않는다."*

**기각된 우회책을 보존한다.** *"타임아웃을 올리면 커넥션 누수가 가려진다. cleanup 경로를 고쳐라."*

**임시 호환 코드를 표시한다.** *"이 caller는 임시이며 지원 계약의 일부가 아니다."*

**검증 공백을 전달한다.** *"단일 사용자 동작은 테스트했다. 동시 갱신은 미검증이다."*

전부 diff가 실어 나를 수 없고, 없으면 리뷰어가 두 번 말해야 하는 문장이다.

## record가 만들어지는 방법

모든 커밋에 trailer를 손으로 쓸 필요는 없다. 대부분의 커밋에는 record가 없어야 한다. 외부 제약, 제외한 대안, 경고, 검증 공백처럼 diff만으로 복구할 수 없는 결정에만 record를 추가한다.

에이전트에게 평소대로 커밋하고 diff로 설명할 수 없는 결정 맥락만 보존하도록 요청한다.

> 이 변경을 커밋해. diff로 중요한 제약, 제외한 대안, 경고 또는 검증 공백을 복구할 수 없을 때만 CommitLore record를 추가해.

에이전트 지침은 `skills/commitlore-commits/`에 있고, commit-msg hook은 에이전트가 추가한 record를 검증할 뿐 record를 발명하거나 조용히 추가하지 않는다. `harvest` 경로, `capture` 트랜잭션, 그리고 사람이 trailer를 직접 쓰는 탈출구는 모두 [docs/capture.md](docs/capture.md)에 있다.

## record 프로토콜

record는 평범한 Git commit trailer 묶음이고, 대개는 작은 것으로 충분하다:

```text
Fix expired-token refresh

Ruled-out: Extend token TTL to 24h | security policy violation
Warn: Do not narrow the 4xx handler without verifying upstream behavior
```

어휘 전체를 쓰는 완전한 예제, 모든 trailer key 표, 그리고 CommitLore 없이 순수 Git으로 읽는 방법은 [docs/protocol.md](docs/protocol.md)에 있다. 규범적 정의는 [SPEC §3](spec/SPEC.md)이다.

## 저장소가 증명하는 것

- 테스트한 Git workflow에서 결정 이력은 rebase, remote transfer, 경로 rename을 거쳐도 유지된다. squash merge는 여느 trailer와 마찬가지로 trailer block을 버린다. `commitlore squash-preserve` 또는 그 GitHub Action이 기록을 옮긴다 — 테스트가 그 경로를 덮는다.
- 모든 route는 같은 trust grading을 써서 신뢰하지 않는 텍스트를 지시가 아닌 정보로 전달한다.
- 자유 형식 trailer의 injection 같은 텍스트는 model-readable route에서 보류된다.
- 읽을 수 있는 저장소의 기록 없음은 불완전한 history나 fetch하지 않은 notes mirror와 구별된다.

이것은 Git에 묶여 사람이 검증할 수 있는 결정 이력에 대한 제품 주장이다. CommitLore가 에이전트 성능을 높인다는 주장에 기대지 않는다.

## 근거: 더 좁은 제품 주장

112회 실험은 기록됐지만 M4에는 run별 `guard_exposure` 기록이 없다. treatment가 있었는지 검증할 수 없으므로 agent behavior 주장을 시험하거나 뒷받침하거나 반박하지 못한다. 위의 더 좁은 제품 주장은 독립적으로 검증 가능한 동작에 근거한다. 깨끗한 데이터셋과 철회 내용은 [M4 verdict](bench/VERDICT-M4.md)에서 읽을 수 있다.

무엇이 측정됐고 무엇이 측정되지 않았는지는 [docs/evidence.md](docs/evidence.md)에 정리돼 있다. 측정된 쪽은 검색, 노출, 지연 시간과 확장, hook 오버헤드이고, 측정되지 않은 쪽은 손익분기와 에이전트 행동에 대한 효과다.


## 제거

```bash
commitlore uninstall
```

`install.sh` 또는 `install.ps1`이 쓴 것을 제거한다 — wrapper, 고정된 checkout,
각 agent config에 추가한 MCP 항목. 자신이 쓰지 않은 것은 제거하지 않는다.
남기는 것을 명시한다: 저장소별 hook, agent hook, Claude Code plugin.
`--dry-run`은 아무것도 바꾸지 않고 보고만 한다. 각각을 무엇이 제거하는지, 그리고
소스 체크아웃에서 실행하는 방법은 [docs/install.md](docs/install.md)에 있다.

## 문서

- [docs/install.md](docs/install.md) — 설치 경로, 각 경로가 쓰는 것, 되돌리는 방법
- [docs/cli.md](docs/cli.md) — 모든 명령과 플래그
- [docs/capture.md](docs/capture.md) — record가 쓰이는 과정
- [docs/protocol.md](docs/protocol.md) — record 형식과 Git만으로 읽는 방법
- [docs/evidence.md](docs/evidence.md) — 무엇이 측정됐고 무엇이 아닌지
- [spec/SPEC.md](spec/SPEC.md) — 규범 프로토콜

## 기여하기

[spec](spec/SPEC.md), [ADR](docs/adr/), [`CONTRIBUTING.md`](CONTRIBUTING.md)를 읽어보라. CommitLore는 [MIT License](LICENSE) 아래에서 영원히 무료인 오픈소스다.
