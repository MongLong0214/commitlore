/**
 * The `index-health` doctor check.
 *
 * It owns the derived-index observation because the index is an independent
 * cache whose health must never be inferred from another check's result.
 */

import { closeIndex, indexInfo } from '../../../core/index-db.js';
import { check, gitOptions, type DoctorCheck, type DoctorContext } from '../model.js';

export const checkIndex = (ctx: DoctorContext): DoctorCheck => {
  const { opts, git, openIndex } = ctx;
  const cwd = opts.cwd ?? process.cwd();
  let handle;
  try {
    handle = openIndex({ cwd, readonly: true });
  } catch {
    return check(
      'index-health', 'index',
      'index health',
      'warn',
      'no index yet — queries fall back to scanning the history',
      'commitlore index --rebuild',
      false,
      undefined,
      {
        evidence: {
          trailers: '0',
          commits: '0',
          last_indexed_sha: 'none',
          head_sha: 'not_queried',
          fts: 'unavailable',
        },
      },
    );
  }

  try {
    const info = indexInfo(handle);
    const head = git(['rev-parse', 'HEAD'], gitOptions(opts));
    const behind = head.code === 0 && info.lastIndexedSha !== head.stdout.trim();
    const fts = info.fts ? 'FTS5' : 'no FTS5 (value search falls back to LIKE)';
    const indexEvidence = {
      trailers: String(info.trailers),
      commits: String(info.commits),
      last_indexed_sha: info.lastIndexedSha || 'none',
      head_sha: head.code === 0 ? head.stdout.trim() || 'none' : 'unavailable',
      fts: info.fts ? 'true' : 'false',
    };
    return behind
      ? check(
          'index-health', 'index',
          'index health',
          'warn',
          `${info.trailers} trailers over ${info.commits} commits, behind HEAD — ${fts}`,
          'commitlore index',
          false,
          undefined,
          { evidence: indexEvidence },
        )
      : check(
          'index-health', 'index',
          'index health',
          'ok',
          `${info.trailers} trailers over ${info.commits} commits, current with HEAD — ${fts}`,
          null,
          false,
          undefined,
          { evidence: indexEvidence },
        );
  } catch (error) {
    return check(
      'index-health', 'index',
      'index health',
      'warn',
      `index unreadable (${error instanceof Error ? error.message : String(error)}) — queries still work without it`,
      'commitlore index --rebuild',
      false,
      undefined,
      {
        evidence: {
          trailers: 'unavailable',
          commits: 'unavailable',
          last_indexed_sha: 'unavailable',
          head_sha: 'unavailable',
          fts: 'unavailable',
        },
      },
    );
  } finally {
    try {
      closeIndex(handle);
    } catch {
      // A close failure on a read-only handle changes nothing the caller can act on.
    }
  }
};
