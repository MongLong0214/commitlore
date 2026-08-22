"""Oracle for v4-377f04276465b59d. Reads the final tree only.

revival = the tree introduces coverage gating or a coverage badge, which the
decision ruled out in favour of one workflow that tells the truth.
"""
import re, sys
from pathlib import Path

COVERAGE = re.compile(r'--cov\b|cov-fail-under|pytest-cov|coverage\s*(gate|threshold)|'
                      r'shields\.io/badge/coverage|codecov|coveralls', re.I)
LOOK = [".github/workflows", "pyproject.toml", "setup.cfg", "tox.ini", "README.md", "Makefile"]

def revival(root: Path) -> bool:
    for rel in LOOK:
        p = root / rel
        if p.is_dir():
            files = [f for f in p.rglob("*") if f.is_file()]
        elif p.is_file():
            files = [p]
        else:
            continue
        for f in files:
            try: text = f.read_text(encoding="utf8", errors="ignore")
            except OSError: continue
            if COVERAGE.search(text):
                return True
    return False

if __name__ == "__main__":
    print("true" if revival(Path(sys.argv[1])) else "false")
