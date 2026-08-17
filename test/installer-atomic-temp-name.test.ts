/**
 * #716: on Windows the installer wrote every config through a temporary file
 * whose name was the entire target path.
 *
 * Observed on a real machine (#714), v1.0.2, Windows 10.0.19045.0:
 *
 *     open 'C:\Users\u\.gemini\.C:\Users\u\.gemini\settings.json.commitlore-….tmp'
 *           └── dirname ──────┘ └── the whole path, used as a filename ────┘
 *
 * The name came from `path.split('/').pop()`, which returns the whole string
 * when there is no `/` in it. A drive letter cannot appear inside a filename,
 * so every host that reached its write failed with ENOENT and nothing was
 * wired.
 *
 * These assertions run on POSIX deliberately. CI has no Windows agent, so the
 * `install-ps1` job detects no hosts and never reaches this code — that is the
 * whole of #714. A Windows-only defect is only guarded if the guard can fail
 * somewhere the defect is not.
 */

import { describe, expect, it } from 'vitest';

import { atomicTemporaryName } from '../src/commands/installer-hosts.js';

const WINDOWS_TARGET = 'C:\\Users\\u\\.gemini\\settings.json';
const POSIX_TARGET = '/home/u/.gemini/settings.json';

describe('#716 the atomic temporary is a name, not a path', () => {
  it('drops the directory from a Windows path', () => {
    // The defect verbatim: `'C:\\…\\settings.json'.split('/').pop()` is the
    // input unchanged, so this assertion is what separates the two.
    expect(atomicTemporaryName(WINDOWS_TARGET, 'pid-uuid')).toBe(
      '.settings.json.commitlore-pid-uuid.tmp',
    );
  });

  it('drops the directory from a POSIX path, as it always did', () => {
    expect(atomicTemporaryName(POSIX_TARGET, 'pid-uuid')).toBe(
      '.settings.json.commitlore-pid-uuid.tmp',
    );
  });

  it('never yields something that can be read as a path', () => {
    // The property rather than the two spellings: a name containing either
    // separator is a name no filesystem will accept as one.
    for (const target of [WINDOWS_TARGET, POSIX_TARGET, 'C:\\a/b\\c.json']) {
      const name = atomicTemporaryName(target, 'u');
      expect(name, target).not.toMatch(/[/\\]/);
      expect(name, `${target}: a drive letter is not part of a filename`).not.toContain(':');
    }
  });

  it('keeps the temporary beside its target, which is what makes the rename atomic', () => {
    // A rename across filesystems is a copy, and a copy is not atomic. The
    // name must therefore stay a sibling — this pins that it carries no
    // directory of its own for the caller to join onto.
    const name = atomicTemporaryName(WINDOWS_TARGET, 'u');
    expect(name.startsWith('.')).toBe(true);
    expect(name.endsWith('.tmp')).toBe(true);
  });
});
