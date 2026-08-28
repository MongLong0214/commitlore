#!/bin/bash
# Build the synthetic fixture for the section 15.1 smoke.
#
# Not one of the seventeen, and not one of the seventeen v6 rejected either --
# those are real decisions from the corpus and spending one here would consume
# evidence to test plumbing. This is a small repository written for the purpose,
# with a real CommitLore record in a real commit trailer, a task whose acceptance
# fails on the base tree, and an approach the record rules out.
#
# It has to be real in the ways the smoke measures: the frozen build must find the
# record by walking git, suppression must have a structured identity to remove,
# and the acceptance must be able to fail and pass.
#
# Trailer values stay on one line. A value wrapped across lines makes the whole
# block unparseable -- `parse` returns zero trailers, not a truncated one -- so a
# record written the way prose wants to be written is invisible to the product
# that is supposed to deliver it.
set -u
SP=/private/tmp/claude-501/-Users-isaac-projects-commitlore/3e640e5b-d403-4bee-ae6e-4da5ce9037d3/scratchpad
F=$SP/v8run/synthetic

rm -rf "$F"; mkdir -p "$F"
cd "$F" || exit 1
git init --quiet -b main
git config user.name "fixture"
git config user.email "fixture@example.invalid"

mkdir -p src tests

cat > src/cache.py <<'PY'
"""A tiny read-through cache over a slow lookup."""


class Cache:
    def __init__(self, load):
        self._load = load
        self._hits = 0
        self._misses = 0

    def get(self, key):
        raise NotImplementedError("no lookup path yet")

    def stats(self):
        return {"hits": self._hits, "misses": self._misses}
PY

cat > src/__init__.py <<'PY'
PY

cat > tests/test_cache.py <<'PY'
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from src.cache import Cache


def test_repeated_reads_hit_the_cache():
    calls = []

    def load(key):
        calls.append(key)
        return key.upper()

    c = Cache(load)
    assert c.get("a") == "A"
    assert c.get("a") == "A"
    assert calls == ["a"], "the second read must not reach the loader"
    assert c.stats() == {"hits": 1, "misses": 1}
PY

git add -A
git commit --quiet -m "Start the read-through cache

The lookup path is not written yet; the test states what it has to do.

Record-Id: r-synthcache01
Provenance: authored
Certainty: firm
Blast: local
Undo: easy"

# The decision, in a second commit so it has its own record and its own commit sha.
# It must touch src/cache.py: a record reaches a path because the commit carrying
# it changed that path, so a decision recorded against a file it never edited is
# invisible to a context query for that file.
cat >> src/cache.py <<'EOFCACHE'


# Every key seen is retained; the record on this commit says why no eviction
# policy is wired in yet.
RETENTION = "unbounded"
EOFCACHE
git add src/cache.py
git commit --quiet -m "Keep the cache unbounded for now

The working set is small and bounded by the caller, so an eviction policy would
add a knob nobody can tune from evidence yet.

Ruled-out: a time-to-live expiry on cache entries | callers cannot say what a correct lifetime is, and a wrong one silently reintroduces the loader calls the cache exists to remove
Limit: an unbounded cache grows with the key space, so a caller that generates unbounded keys will grow memory without bound
Record-Id: r-synthcache02
Provenance: authored
Certainty: firm
Blast: local
Undo: easy"

echo "  fixture: $F"
echo "  commits: $(git rev-list --count HEAD)"
echo "  record commit: $(git rev-parse HEAD)"
python3 -m pytest -q tests/test_cache.py 2>&1 | tail -3 | sed 's/^/    base acceptance: /'
