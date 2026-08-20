<!-- README:BRAND -->
<p align="center">
  <img src="./assets/readme/commitlore-logo.svg" width="440" alt="CommitLore">
</p>

<h1 align="center">CommitLore</h1>

<h3 align="center">코딩 에이전트가 팀에서 이미 기각한 방안을 계속 다시 제안합니다.</h3>

<p align="center">
  <strong>Git이 소유하는 코딩 에이전트의 결정 권위.</strong><br>
  제약, 기각한 대안, 경고를 Git에 보관하고 아직 유효한 것만 전달합니다.
  그러면 에이전트는 저장소가 이미 뒤집은 결정을 다시 지침으로 받지 않습니다.
</p>

<p align="center">
  <strong>CommitLore에는 호스팅 서비스가 없습니다. record는 저장소가 소유합니다.</strong>
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/MongLong0214/commitlore/actions/workflows/ci.yml/badge.svg">
  </a>
  <a href="https://github.com/MongLong0214/commitlore/releases">
    <img alt="최신 릴리스" src="https://img.shields.io/github/v/release/MongLong0214/commitlore?display_name=tag">
  </a>
  <a href="spec/SPEC.md">
    <img alt="프로토콜 2.0 안정" src="https://img.shields.io/badge/protocol-2.0%20stable-3FB950">
  </a>
  <a href="package.json">
    <img alt="Node.js 22.23.2 이상" src="https://img.shields.io/badge/node-22.23.2%2B-3FB950">
  </a>
  <a href="LICENSE">
    <img alt="MIT 라이선스" src="https://img.shields.io/badge/license-MIT-3FB950">
  </a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <strong>한국어</strong> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>한 번 설치한다.</strong> 그런 다음 사용할 각 저장소를 초기화합니다.
</p>

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh | sh -s v1.2.0
```

<details>
<summary>먼저 설치기를 읽어 보고 싶나요?</summary>

```bash
curl -fsSLO https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh
sh install.sh v1.2.0

# 또는 스크립트를 건너뜁니다. 스크립트가 만드는 체크아웃은 직접 만들 수 있습니다.
git clone --depth 1 --branch v1.2.0 https://github.com/MongLong0214/commitlore
node commitlore/dist/commitlore.mjs --version
```

고정된 소스 체크아웃과 `node <checkout>/dist/commitlore.mjs`를 실행하는 wrapper를
설치합니다. 컴파일된 다운로드도, 빌드 단계도 없습니다.

</details>

<p align="center">
  <img
    src="./assets/readme/demo.gif"
    width="900"
    alt="commitlore 데모는 src/pricing.ts에 기록된 결정 두 개를 출력하고, limit과 기각한 대안을 가진 활성 결정만 전달하며, 대체된 결정은 Git에는 남지만 현재 지침으로 전달하지 않는다고 보여 줍니다."
  >
</p>

---

> **코드는 남는다. 판단은 남지 않는다.**

에이전트가 한 접근을 제안합니다. 팀은 쉽게 드러나지 않는 제약 때문에 이를 기각합니다.
최종 코드는 결과를 남기지만, 대안을 왜 기각했는지는 대개 남기지 않습니다. 나중의 에이전트는
코드만 보고 같은 생각을 다시 제안합니다.

CommitLore는 그 판단을 코드 곁에 보관합니다.

## CommitLore가 하는 일

| | 동작 | 제품 경로 |
|---|---|---|
| **Capture** | diff가 보여 줄 수 없는 제약, 기각한 대안, 경고를 보존합니다. 후보는 세션 transcript와 staged diff에 대조합니다. | `commitlore capture` |
| **Preserve** | 호스팅 메모리 데이터베이스 대신 Git trailer 또는 notes에 승인된 record를 저장합니다. | commit hook · `refs/notes/commitlore` |
| **수명 주기 추적** | 활성, 대체됨, 만료된 결정을 구분합니다. | `commitlore stale` |
| **범위 지정** | 에이전트가 곧 편집할 path에 맞는 결정을 고릅니다. | `commitlore context` |
| **신뢰 등급** | record를 directive, claim, 또는 보류된 내용으로 전달합니다. | 기본 / signed mode |
| **Delivery** | 지원하는 에이전트가 편집 전에 현재 맥락을 받게 합니다. | plugin hook · MCP |

대부분의 commit에는 record가 없어야 합니다. CommitLore는 모든 변경을 설명하는 도구가 아니라,
코드가 보존할 수 없는 판단을 위한 도구입니다.

<!-- README:QUICKSTART -->
## 60초 만에 decision-aware agent 만들기

### 1. CLI 설치

macOS와 Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.sh | sh -s v1.2.0
```

Windows:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/MongLong0214/commitlore/v1.2.0/install.ps1))) v1.2.0
```

Node.js 22.23.2+와 Git이 필요합니다. 스크립트는 무엇이든 쓰기 전에 둘을 확인합니다.

### 2. 에이전트 연결

Claude Code:

```text
/plugin marketplace add MongLong0214/commitlore
/plugin install commitlore@commitlore
```

Codex:

```bash
commitlore plugin install-codex
```

plugin은 `commitlore`를 `PATH`에 넣지 않으므로, 아래 명령에는 CLI 설치도 필요합니다.
설치기는 안전하게 할 수 있는 범위에서 지원하는 MCP host를 감지하고 배선합니다. 정확한 표는 아래에 있습니다.

### 3. 저장소 초기화

```bash
cd your-repository
commitlore init
commitlore context .
```

plugin을 설치하거나 업데이트한 뒤에는 새 에이전트 session을 시작합니다. 실행 중인 session은
처음 불러온 runtime을 계속 사용합니다.

그다음에는 평소처럼 작업하고 commit합니다. 지원되는 skill integration에서는 보통의 commit 요청에도
CommitLore를 고려하고, 보존할 것이 없으면 조용히 지나갑니다. 매 commit마다 CommitLore를 말할 필요가 없습니다.

record마다 확인하지 않고 승인된 record를 stage하고 싶다면 저장소에서 한 번
`commitlore auto on`을 선택할 수 있습니다. 이 정책은 저장소가 소유하고 팀 전체에 적용되므로,
이 페이지가 조용히 켜지지는 않습니다.

<!-- README:PAYLOAD -->
## 에이전트가 받는 것

`src/pricing.ts`를 편집하기 전에:

```text
commitlore: active records for src/pricing.ts

Limit
  [claim] r-price01  calculatePrice owns final checkout pricing only

Ruled-out
  [claim] r-price01  Reuse it for admin quotes |
                     eligibility and rounding semantics differ
```

`[claim]`은 "정보로서 평가하라"는 뜻입니다. 저장소는 더 강한 signed-authority mode를
선택할 수 있습니다. delivery는 맥락을 줄 뿐, 편집을 막지 않습니다.

[보안 모델 →](SECURITY.md)

## 왜 Git인가?

**저장소가 코드 뒤에 있는 판단을 소유해야 합니다.**

CommitLore는 record를 평범한 Git trailer와 notes에 저장합니다. 그러므로 record는 그 코드를
설명하는 방식 그대로 branch, merge, clone, review를 거치고 provider가 바뀌어도 살아남습니다.

SQLite는 다시 만들 수 있는 index일 뿐입니다. 지워도 record는 Git에 남습니다.

## 오래된 결정 하나를 찾는 것만으로는 충분하지 않습니다

일반 memory 또는 retrieval system은 이렇게 묻습니다.

> 어떤 오래된 텍스트가 관련 있어 보이는가?

CommitLore는 이렇게 묻습니다.

> 기록된 결정 중 지금 이 path에 적용되는 것은 무엇인가?

대체된 결정은 매우 관련 있어 보여도 현재 지침으로는 틀릴 수 있습니다. 관련성과 권위는
서로 다른 질문입니다.

## 어떻게 동작하나

<p align="center">
  <img src="./assets/readme/hero.svg" width="720" alt="src/pricing.ts에서 Git 이력의 활성 결정은 다음 편집 전에 전달되는 맥락으로 이동하며, 그 limit과 기각한 대안을 함께 지닙니다. 관리자 견적도 다루던 이전 결정은 대체되어 이력에는 남지만 현재 지침으로는 전달되지 않습니다.">
</p>

1. **Capture** — 에이전트는 diff가 보여 줄 수 없는 결정 맥락만 초안으로 씁니다.
2. **Verify** — CommitLore는 초안을 세션과 staged diff에 대조합니다.
3. **Preserve** — 승인된 record는 identity와 lifecycle을 갖고 Git에 남습니다.
4. **Deliver** — 나중의 편집 전에는 그 path의 활성 record만 반환합니다.

대부분의 commit에는 record가 없습니다. commit hook은 record가 있을 때 검증하지만 발명하지는 않습니다.

기존 hook을 덮어쓰지 않습니다. `commitlore init`은 `core.hooksPath`를 따르고, 이미 설치된 hook을
`<hook>.commitlore-chained`로 옮긴 뒤 먼저 호출합니다. `commitlore hooks uninstall`은 이를 되돌립니다.

<!-- README:CAPABILITY -->
## 자동으로 되는 것과 아닌 것

| Host | 편집 전 delivery | 검증된 capture 워크플로 | 모든 commit에서 결정적으로 capture |
|---|---|---|---|
| Claude Code | plugin을 통해 자동 | plugin skill로 사용 가능 | **인증되지 않음** |
| Codex | plugin을 통해 자동 | plugin skill로 사용 가능 | **인증되지 않음** |
| Hermes | `commitlore hermes install` 뒤 사용 가능 | host 설치 뒤 사용 가능 | **인증되지 않음** |
| Gemini CLI, Cursor, Windsurf, opencode | host가 등록을 사용할 때 MCP delivery | MCP로 노출된 procedure | 아니요 |
| `AGENTS.md` host | procedure만 | procedure만 | 아니요 |

"사용 가능"은 prepare → verify → stage workflow가 있다는 뜻입니다. 모든 적격 commit이
자동으로 평가된다는 뜻은 아닙니다.

지원되는 skill host 사용자는 매 commit마다 "이것을 CommitLore에 기록해"라고 말할 필요가 없습니다.
남는 한계는 record마다 필요한 사용자 명령이 아니라 host가 시작하는가입니다.

## 현장 보고이지 측정은 아닙니다

관련 없는 한 저장소에서 v1.2.0을 처음 설치한 사람이 한 번 실행한 사례입니다. 여기서는 아무것도
측정하지 않았고 evidence log에도 없습니다. 위 문단이 표로 다루지 않는 loop를 주장하기 때문에
이 페이지에 있습니다.

그 사람은 agent에게 반올림 버그를 고쳐 달라고 했고, decimal library를 이미 검토했다가 기각했다는
말을 덧붙인 뒤 "commit해"라고 끝냈습니다. CommitLore라는 이름은 한 번도 나오지 않았습니다.
commit이 실은 일부는 다음과 같습니다.

```
Ruled-out: adopting a decimal library such as Decimal.js | the backend is a
  number contract, so it is meaningless
Warn: do not revert the test file to console.assert: it exits 0 even on
  failure, so CI passes silently
Provenance: drafted
```

`Warn`은 agent에게 받아쓰게 한 것이 아닙니다. 작업 중 함정을 만나고 다음 사람을 위해 남긴 것입니다.
`Provenance: drafted`는 사람이 record를 읽지 않았음을 나타내며, 이는 `claim`으로 등급을 매깁니다.
즉 명령이 아니라 평가할 보고서로 전달됩니다.

공유 이력이 없는 나중 session은 결국 decimal library를 도입하라는 요청을 받았습니다. 도입하지 않고
그 이유로 record를 들었습니다. 또 등급도 읽었습니다. `claim`은 지시가 아니므로 동의하기 전에
명시된 이유를 코드와 대조했습니다.

## 메모리 저장소와 달리

| | 일반 memory / RAG | **CommitLore** |
|---|---|---|
| 주된 질문 | 어떤 오래된 텍스트가 관련 있는가? | 지금 여기에 어떤 결정이 적용되는가? |
| 권위 | memory store 또는 provider | Git |
| 범위 | 의미적 유사도 | repository path |
| lifecycle | 흔히 append-first | 활성 · 대체됨 · 만료됨 |
| 신뢰 | 검색된 text | directive · claim · blocked |
| capture | transcript 또는 note 저장 | 근거를 대조한 결정 record |
| 이식성 | backend에 종속 | 평범한 Git |

CommitLore는 의도적으로 더 좁습니다. 일반 사용자 memory system, 대화 archive, vector database를
대체하는 도구가 아닙니다.

<!-- README:EVIDENCE -->
## 근거: 검색은 레코드를 찾을 수 있습니다

| 질문 | 측정 결과 | 경계 |
|---|---|---|
| 등록된 연구에서 claim 등급 맥락이 재제안에 변화를 주었는가? | CommitLore 사용 시 **2.8%** (16/580), 미사용 시 **18.8%** (109/579) | 모델 하나, harness 하나, 구성한 task |
| lifecycle filtering이 측정된 활성 projection에서 은퇴한 record를 전달했는가? | **은퇴한 record 0개** | 대체된 record는 있었고 만료는 없었음 |
| index된 조회는 확장되는가? | **commit 100k에서 p50 496 ms** | index 없는 fallback은 훨씬 느림 |

index 구축 시간은 commit 수가 아니라 *record* 수를 따릅니다. 비용이 큰 단계는 record마다 한 번만
실행되므로, 기록이 적은 긴 이력은 record가 빽빽한 짧은 이력보다 더 빨리 구축됩니다.

path 범위가 큰 이력이 model에 닿지 않게 합니다. #167 corpus에서는 10,002개 record 중 2개만 닿았습니다.

| 경로 | 모델에 보인 레코드 | 관련 레코드 | 모델에 보인 토큰 |
|---|---:|---:|---:|
| 모두 주입 | 10,002 | 2/2 | 1,004,554 |
| top-k 어휘 검색 | 2 | 1/2 | 190 |
| CommitLore 경로 범위 | 2 | 2/2 | 335 |

이는 고정된 두 record 예산에서의 노출과 재현율을 측정한 것입니다. token 비용, 청구 비용, 정확도,
agent 행동은 측정하지 않습니다. corpus 하나, query 하나, 고정된 embedding model 하나입니다.

agent 연구는 보편적인 model 효과를 증명하지 않습니다. delivery는 model이 record를 읽거나
따랐다는 증거가 아닙니다.

[방법, 전체 표, 제외 항목, 부정적 결과 →](docs/evidence.md)

<!-- README:LIMITS -->
## 이것이 도움이 되지 않는 경우

- **Capture는 보조되며 결정적이지 않습니다.** 지원되는 skill은 보통의 commit 요청을 고려하지만,
  모든 적격 commit을 평가하는 host는 인증되지 않았습니다.
- **기본 directive mode는 인증이 아닙니다.** commit author header를 대조하고, commit을 쓸 수 있는
  누구나 그 header를 정할 수 있습니다. 따라서 기본 mode의 `[directive]`는 identity 증명이 아니라
  policy metadata입니다. signature mode에는 Git 자체의 verified status와 repository-local
  `commitlore.trustedSigner` allowlist의 일치가 추가로 필요합니다. signer allowlist가 없거나 비었거나
  읽을 수 없으면 아무도 권한을 얻지 않으므로 이 mode는 fail-closed입니다.
- **Guard는 실험적 참고 자료**이며 안전망이 아닙니다: precision 44.8% (95% Wilson CI 32.7%–57.5%),
  recall 22.0%, 417-decision corpus 기준입니다. 빈 guard 결과는 안전 판정이 아닙니다.
- **Delivery는 일치하는 모든 tool call에서 token을 씁니다.** 편집 전 hook은 `Read`뿐 아니라 `Edit`,
  `Write`, `MultiEdit`, `NotebookEdit`에서도 실행되어 editing agent가 commit하는 횟수보다 훨씬 많이
  실행됩니다. 한 번 실행할 때 기본 800 token까지 payload를 사용하며 `--budget`으로 바꿉니다.
  record 없는 저장소는 아무것도 쓰지 않으므로, 이는 설치가 아니라 채택과 함께 생기는 비용입니다.
- **답은 일부만 담을 수 있습니다.** coverage는 공개되며, 일부 결과에 없다고 record가 없다는 증거는
  아닙니다. repository-wide coverage, symbol anchor, interactive record builder는 아직 열려 있습니다:
  [#32](https://github.com/MongLong0214/commitlore/issues/32),
  [#33](https://github.com/MongLong0214/commitlore/issues/33).
- **commit trailer는 clone과 함께 오지만 notes는 그렇지 않습니다.** Git은 기본으로 `refs/notes/*`를
  fetch하지 않으므로 `refs/notes/commitlore`의 record는 `commitlore init`이 mirror를 구성하기 전까지
  ordinary clone에 없습니다.
- **호스팅 backend는 없습니다.** 하지만 server 또는 hook이 맥락을 반환하면 host는 자신의 정책에 따라
  그 맥락을 처리합니다. CommitLore는 그 데이터 흐름을 제어하지 않습니다.

[보안](SECURITY.md) ·
[호환성](docs/COMPATIBILITY.md) ·
[근거](docs/evidence.md)

<details>
<summary><strong>보안과 신뢰 모델</strong></summary>

record는 등급이 매겨질 때까지 신뢰할 수 없습니다. 기본 author matching은 인증이 아니라 policy
metadata입니다. signed directive mode에는 Git 검증과 repository-local signer allowlist가 필요하며,
allowlist가 없거나 읽을 수 없으면 아무도 권한을 얻지 못합니다. injection 모양 payload는
model-readable route에서 보류됩니다.

[전체 보안 모델 →](SECURITY.md)

</details>

<details>
<summary><strong>설치, 업그레이드, 이전 hook 세대</strong></summary>

CLI installer는 자신이 모르는 저장소의 hook을 다시 쓸 수 없고, 실행 중인 host session은 처음
불러온 runtime을 유지합니다. `commitlore doctor`는 두 상태와 수리 방법을 알려 주고,
`commitlore upgrade`는 새 release가 있는지 보고합니다.

[설치와 업그레이드 →](docs/install.md)

</details>

<details>
<summary><strong>프로토콜과 Git 저장소</strong></summary>

record는 평범한 Git trailer 또는 notes입니다. Protocol 2.0은 lifecycle, trust grade, validation,
compatibility를 정의합니다.

[사람을 위한 안내 →](docs/protocol.md) ·
[규범 명세 →](spec/SPEC.md)

</details>

<details>
<summary><strong>근거와 부정적 결과</strong></summary>

저장소는 방법, 제외 항목, 실패한 측정, 원래 benchmark 또는 진단이 틀렸던 경우를 공개합니다.

[근거 →](docs/evidence.md) ·
[자체 점검 →](docs/SELF-AUDIT.md)

</details>

<hr>

<p align="center">
  <strong>이력이 있는 저장소에서 사용해 보세요.</strong><br>
  <sub>path 범위, lifecycle, capture, 설치가 깨지는 곳을 알려 주세요.</sub>
</p>

<p align="center">
  <a href="https://github.com/MongLong0214/commitlore/issues/new">실패 사례 보고</a>
  ·
  <a href="docs/SELF-AUDIT.md">자체 점검 읽기</a>
</p>

<hr>

<!-- README:DOCS -->
## 문서

- [설치, 업그레이드, 제거](docs/install.md)
- [CLI 참고서](docs/cli.md)
- [Capture 워크플로](docs/capture.md)
- [Record 프로토콜](docs/protocol.md)
- [보안 모델](SECURITY.md)
- [근거와 한계](docs/evidence.md)
- [운영 계약](docs/PRODUCTION-READINESS-SSOT.md)
- [문서 색인](docs/README.md)

## 기여하기

[CONTRIBUTING.md](CONTRIBUTING.md)에는 이 저장소가 스스로 지키는 record protocol, release gate,
그리고 근거를 재현하는 방법이 있습니다.

## 라이선스

MIT — [LICENSE](LICENSE)를 보세요.
