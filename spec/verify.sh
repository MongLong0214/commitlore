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

if [ "$fail_count" -gt 0 ]; then
  echo "FAILED: $fail_count of $checked_count fixtures" >&2
  exit 1
fi

echo "OK: $checked_count fixtures"
exit 0
