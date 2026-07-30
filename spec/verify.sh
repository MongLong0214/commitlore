#!/usr/bin/env bash
# spec/verify.sh — T-102 fixture verification.
#
# For every fixture in spec/fixtures/{valid,boundary,invalid}/:
#   1. Parse the .txt with `git interpret-trailers --parse --no-divider` and
#      diff the result against the `trailers` array in the sibling
#      *.expected.json (order-sensitive — SPEC §2.1 B5).
#   2. valid/ and boundary/: the `trailers` MUST validate against
#      spec/schema/record.schema.json, and the `canonical` block MUST
#      round-trip (parse -> canonical serialize -> parse, SPEC §2.3).
#      invalid/: the `trailers` MUST be rejected by the schema — except a
#      `dangling-ref` violation, which is a cross-record check no
#      single-record JSON Schema can express (see the schema's $comment);
#      for those we only confirm git itself still parses the trailers fine.
#
# Usage: bash spec/verify.sh
# Exit 0 + "OK: N fixtures" on success. Exit 1 with per-fixture diagnostics
# on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA="$SCRIPT_DIR/schema/record.schema.json"
VALIDATE="$SCRIPT_DIR/schema/validate.mjs"
COMPARE="$SCRIPT_DIR/schema/compare-trailers.mjs"
ROUNDTRIP="$SCRIPT_DIR/schema/roundtrip.mjs"

fail_count=0
checked_count=0

fail() {
  local msg="$1"
  echo "FAIL: $msg" >&2
  fail_count=$((fail_count + 1))
}

check_fixture() {
  local kind="$1" # valid | boundary | invalid
  local txt="$2"
  local json="${txt%.txt}.expected.json"
  local name
  name="$(basename "$txt")"

  if [ ! -f "$json" ]; then
    fail "$name: missing sibling $(basename "$json")"
    return
  fi

  checked_count=$((checked_count + 1))

  # 1. git interpret-trailers actual vs expected.trailers (all kinds).
  if ! node "$COMPARE" "$txt" "$json" 2>/tmp/commitlore-verify-err.$$; then
    fail "$name: git interpret-trailers output does not match expected.trailers"
    cat /tmp/commitlore-verify-err.$$ >&2
    rm -f /tmp/commitlore-verify-err.$$
    return
  fi
  rm -f /tmp/commitlore-verify-err.$$

  if [ "$kind" = "invalid" ]; then
    # 3. invalid/: schema MUST reject, unless the violation is dangling-ref
    # (structurally undetectable within a single record — see schema $comment).
    local rule
    rule="$(node -e "
      const v = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
      process.stdout.write((v.violations && v.violations[0] && v.violations[0].rule) || '');
    " "$json")"

    if node "$VALIDATE" "$SCHEMA" "$json" >/tmp/commitlore-verify-schema.$$ 2>&1; then
      if [ "$rule" = "dangling-ref" ]; then
        : # expected: schema cannot catch a dangling-ref, not a failure.
      else
        fail "$name: expected schema to reject (rule=$rule) but it validated"
      fi
    fi
    rm -f /tmp/commitlore-verify-schema.$$
    return
  fi

  # 2. valid/ and boundary/: schema MUST accept.
  if ! node "$VALIDATE" "$SCHEMA" "$json" 2>/tmp/commitlore-verify-err.$$; then
    fail "$name: schema rejected a $kind fixture"
    cat /tmp/commitlore-verify-err.$$ >&2
    rm -f /tmp/commitlore-verify-err.$$
    return
  fi
  rm -f /tmp/commitlore-verify-err.$$

  # 2b. canonical round-trip (parse -> canonical serialize -> parse).
  if ! node "$ROUNDTRIP" "$json" 2>/tmp/commitlore-verify-err.$$; then
    fail "$name: canonical serialization does not round-trip"
    cat /tmp/commitlore-verify-err.$$ >&2
    rm -f /tmp/commitlore-verify-err.$$
    return
  fi
  rm -f /tmp/commitlore-verify-err.$$
}

for txt in "$SCRIPT_DIR"/fixtures/valid/*.txt; do
  check_fixture "valid" "$txt"
done

for txt in "$SCRIPT_DIR"/fixtures/boundary/*.txt; do
  check_fixture "boundary" "$txt"
done

for txt in "$SCRIPT_DIR"/fixtures/invalid/*.txt; do
  check_fixture "invalid" "$txt"
done

# 4. README의 대표 예제는 픽스처와 바이트 단위로 같아야 한다.
#    README가 자기 스펙을 위반한 채 배포되는 것이 이 프로젝트에서 가장 비싼 결함이다
#    (실제로 Certainty: high / Blast: narrow / Undo: clean 이 실려 있었고, 셋 다 우리
#    자신의 거부 픽스처 값이었다). 예제를 픽스처로 승격하고 동기화를 기계로 강제한다.
README_FIXTURE="$SCRIPT_DIR/fixtures/valid/11-readme-example.txt"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
for readme in "$REPO_ROOT"/README.md "$REPO_ROOT"/README.*.md; do
  [ -f "$readme" ] || continue
  if ! node -e '
    const fs = require("fs");
    const md = fs.readFileSync(process.argv[1], "utf8");
    const fixture = fs.readFileSync(process.argv[2], "utf8");
    const m = [...md.matchAll(/```text\n([\s\S]*?)\n```/g)].at(-1);
    if (!m) { console.error("no ```text example block"); process.exit(1); }
    if (m[1] + "\n" !== fixture) {
      console.error("README example drifted from spec/fixtures/valid/11-readme-example.txt");
      process.exit(1);
    }
  ' "$readme" "$README_FIXTURE" 2>/tmp/commitlore-readme-err.$$; then
    fail "$(basename "$readme"): 대표 예제가 픽스처와 다르다 — README가 스펙을 위반할 수 있다"
    cat /tmp/commitlore-readme-err.$$ >&2
  fi
  rm -f /tmp/commitlore-readme-err.$$
done

# 5. README의 어휘표가 SPEC §3과 일치하는가.
#    표에 스펙에 없는 키가 실리면 사용자가 그걸 쓰고 검증기에 거부당한다.
if ! node "$SCRIPT_DIR/schema/readme-vocab-check.mjs" \
  "$SCRIPT_DIR/SPEC.md" "$REPO_ROOT"/README.md "$REPO_ROOT"/README.*.md \
  >/tmp/commitlore-vocab.$$ 2>&1; then
  fail "README 어휘표가 SPEC §3과 다르다"
  cat /tmp/commitlore-vocab.$$ >&2
fi
rm -f /tmp/commitlore-vocab.$$

if [ "$fail_count" -gt 0 ]; then
  echo "FAILED: $fail_count of $checked_count fixtures" >&2
  exit 1
fi

echo "OK: $checked_count fixtures + README example sync + vocab table"
exit 0
