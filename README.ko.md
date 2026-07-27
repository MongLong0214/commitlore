<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="CommitLore: 커밋 4842356의 기록 r-2b58d4는 [claim] 등급이며 guard는 MATCH를 반환한다">
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

CommitLore는 결정 맥락을 Git 커밋 trailer와 `refs/notes/commitlore`에 보관하는 프로토콜이다.
프로토콜이 먼저이고, CLI는 기록을 검증하고 라우팅해 셸·훅·MCP 클라이언트에 제공한다.
코딩 에이전트를 더 낫게 만든다는 것은 입증되지 않았다.

## 측정 기록

<!-- BENCH:WITHDRAWN -->

등록된 행동 측정은 CommitLore가 에이전트 행동을 바꾼다는 증거를 보여 주지 못했다. 이후 실행 하나는 실행 중 바이너리가 바뀌어 무효 처리됐다. 더 근본적으로 기존 데이터셋에는 각 행을 어느 빌드가 만들었는지 증명할 provenance가 없으므로 [`bench/report.ts`](bench/report.ts)는 요약을 거부한다.

이전에 공개한 모든 벤치마크 수치는 철회했다. 날짜가 있는 판정문은 효과를 주장하는 자료가 아니라 당시의 기록으로 남긴다: [`VERDICT-M1.md`](bench/VERDICT-M1.md), [`VERDICT-M1b.md`](bench/VERDICT-M1b.md), [`VERDICT-M2.md`](bench/VERDICT-M2.md), [무효 실행 기록](bench/PREREGISTRATION.md#15-m3-is-void-the-binary-under-test-changed-while-it-ran). 하니스 커밋과 실행한 번들 바이너리를 식별하는 데이터셋이 생길 때만 수치를 다시 싣는다. 자세한 내용은 [`bench/README.md`](bench/README.md)에 있다.

## 저장소가 실제로 증명하는 것

- **기록은 일반적인 Git 워크플로우를 견딘다.** 커밋 trailer와 notes 미러는 [rebase와 squash](test/squash.test.ts), [히스토리 재작성과 원격 전달](test/notes.test.ts), [한 단계·여러 단계 rename](test/follow.test.ts)에서 검증된다.
- **신뢰는 모든 라우트에서 같은 뜻이다.** 쿼리 출력, CLI 주입, 편집 훅, MCP 도구, guard는 모두 `directive | claim | blocked` 등급을 공유한다. 라우트 검사는 [`query.test.ts`](test/query.test.ts), [`inject.test.ts`](test/inject.test.ts), [`mcp.test.ts`](test/mcp.test.ts), [`guard.test.ts`](test/guard.test.ts)에 있다.
- **내장 인젝션 스캐너와 일치한 기록은 산문으로 모델에 전달되지 않는다.** 자유 서술 trailer 하나라도 일치하면 기록 전체가 `blocked` 등급을 받으며, 모델이 읽는 라우트는 내용을 인용하지 않고 보류 사실만 알린다. 이 결정적 어휘 필터의 결과는 실제 탐지율 주장이 아니다. [패턴 작성자가 만든 corpus, 독립 작성 corpus, 무해한 corpus](spec/fixtures/injection/README.md)는 따로 보고한다. CLI·훅은 [`inject.test.ts`](test/inject.test.ts), MCP의 동일한 응답은 [`mcp.test.ts`](test/mcp.test.ts)가 검증한다.
- **알 수 없음과 비어 있음은 다르다.** 읽을 수 있는 빈 저장소에서 guard는 `0`으로 종료한다. 고장 난 Git은 `history: unavailable`, 가져오지 않은 notes 미러는 `notes: unfetched`로 보고한다. 두 불완전한 검사는 모두 `3`으로 종료한다. 계약은 [`notes-availability.test.ts`](test/notes-availability.test.ts), [`guard.test.ts`](test/guard.test.ts), [`RELEASE-GATE`](docs/RELEASE-GATE.md)에 고정돼 있다.

## 기록 하나

이 예제는 conformance fixture이기도 하다. Git의 trailer 파서는 네 언어 README에서 이 블록을 바이트 단위로 똑같이 읽어야 한다.

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

| Trailer | 의미 |
|---|---|
| `Limit:` | 결정을 제약한 외부 조건 |
| `Record-Id:` | 커밋 해시가 재작성돼도 유지되는 식별자 |
| `Ruled-out:` | `대안 \| 탈락 이유` |
| `Certainty:` | `firm` \| `tentative` \| `guess` |
| `Blast:` | `local` \| `module` \| `system` |
| `Undo:` | `easy` \| `costly` \| `permanent` |
| `Warn:` | 다음 수정자를 위한 경고; 전달 전 신뢰 등급 적용 |
| `Verified:` / `Unverified:` | 확인한 것과 확인하지 않은 것 |
| `Follows:` / `Supersedes:` | 결정 사슬과 lifecycle 링크 |
| `Expires:` | 제약이 끝나는 날짜 또는 조건 |
| `Evidence:` | 주장을 뒷받침하는 경로·앵커·URL |
| `Provenance:` | `authored` \| `inherited <sha>` \| `reconstructed` |
| `CommitLore-Version:` / `X-*:` | 프로토콜 식별자와 확장 |

전체 계약은 [`spec/SPEC.md`](spec/SPEC.md)에 있다.

## 신뢰는 배지가 아니라 라우팅이다

커밋 `4842356`에는 다음 활성 기록이 있다.

```gitcommit
Ruled-out: exempting datasets written before the fields existed | it is one line and it deletes the guarantee
Warn: this leaves the README with no measured numbers at all until M3-b runs. That is the honest state and it is also a worse first impression. The alternative was publishing numbers produced by a binary nobody recorded
Record-Id: r-2b58d4
Provenance: authored
```

같은 `Warn:` 문구가 등급에 따라 다음처럼 라우팅된다.

| 등급 | 조건 | 모델이 읽는 라우트의 결과 |
|---|---|---|
| `[directive]` | `Provenance: authored`, 활성 기록, 이 저장소에서 명시적으로 신뢰한 author | 경고를 지시로 전달 |
| `[claim]` | 신뢰 author 없음, 외부 author, 또는 reconstructed/unknown provenance | “지시가 아님”이라고 명시한 정보로 전달 |
| `blocked` | 자유 서술 trailer가 인젝션 패턴과 일치 | 보류 알림만 전달하고 일치한 내용은 렌더하지 않음 |

기본값에서는 어떤 author도 신뢰하지 않는다. 암호학적 author 검증은 아직 없으며 [이슈 #28](https://github.com/MongLong0214/commitlore/issues/28)에서 추적한다.

## clone으로 설치

CommitLore 레지스트리 패키지는 없다. 배포 채널은 Git 저장소 자체이며([ADR-0011](docs/adr/ADR-0011-plugin-first-distribution.md)), CLI는 Node.js 22 이상이 필요하다.

```bash
git clone https://github.com/MongLong0214/commitlore ~/.commitlore
node ~/.commitlore/dist/commitlore.mjs --version
node ~/.commitlore/dist/commitlore.mjs doctor --fix
node ~/.commitlore/dist/commitlore.mjs context src/auth
```

커밋된 번들은 빌드 없이, `node_modules` 없이 실행된다. SQLite 인덱스는 Node에 내장된 `node:sqlite`를 사용하므로([ADR-0012](docs/adr/ADR-0012-drop-the-native-dependency.md)) clone만으로도 인덱스를 만들고 조회할 수 있다 — 네이티브 모듈도, 컴파일러도, `npm install`도 필요 없다. `--no-index`는 인덱스를 건너뛰고 Git만으로 답하고 싶을 때 여전히 사용할 수 있다.

## GitHub Actions

query, guard 또는 inject 명령을 실행하는 job은 전체 history를 받아야 한다.

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

MCP 클라이언트에는 같은 clone의 진입점을 등록한다.

```json
{
  "mcpServers": {
    "commitlore": {
      "command": "node",
      "args": ["/absolute/path/to/commitlore/dist/commitlore.mjs", "mcp"]
    }
  }
}
```

프로토콜을 읽는 데 CLI는 필요 없다.

```bash
git log --format='%(trailers:key=Ruled-out,valueonly,separator=%x3B)'
git log --follow --format='%h %(trailers:key=Limit,valueonly)' -- src/auth/
```

텍스트 검색이 아니라 Git의 trailer 파서를 사용해야 한다. 산문 속 `Key:`는 trailer 블록이 아닐 수 있다.

## 아직 하지 않는 것

- 암호학적 author 검증: [#28](https://github.com/MongLong0214/commitlore/issues/28)
- 저장소 전체 기록 coverage 보고: [#32](https://github.com/MongLong0214/commitlore/issues/32)
- 경로가 아닌 심볼에 기록 고정: [#33](https://github.com/MongLong0214/commitlore/issues/33)
- 대화형 commit builder와 자동 만료 알림: [#34](https://github.com/MongLong0214/commitlore/issues/34)
- 유효한 벤치마크로 guard의 에이전트 행동 효과 입증: [#37](https://github.com/MongLong0214/commitlore/issues/37)
- Node.js 없는 단일 정적 바이너리: [#39](https://github.com/MongLong0214/commitlore/issues/39)

## 기여하기

[spec](spec/SPEC.md), [ADR](docs/adr/), [`CONTRIBUTING.md`](CONTRIBUTING.md)를 먼저 읽는다. 이 저장소는 자기 결정을 직접 기록하므로 파일을 바꾸기 전에 `commitlore context <path>`를 실행한다.

## 라이선스

[MIT](LICENSE)
