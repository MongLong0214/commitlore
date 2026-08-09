/**
 * T-1015 (#207): README section order — `See it work` sits after the install
 * command and before the evidence section, across all four language files.
 *
 * Binding anchors from the CEO amendment. #450 restructured the opening, so
 * two anchors point at the sentences that carry those properties rather than
 * at the wording they had before. THE REQUIRED ORDER IS UNCHANGED, and so is
 * what each anchor stands for:
 *   product  → the opening problem sentence (was: the hero heading)
 *   local-first → "without a hosted service" (was: "No hosted memory service.")
 *   install promise → "Install once."
 *   install command → the `curl` block
 *   evidence → "Retrieval can find records. Path scope keeps reversed decisions out."
 *
 * The required order is:
 *   product < local-first < install-promise < install-command < see-it-work < evidence
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

interface ReadmeAnchors {
  file: string;
  product: number;
  localFirst: number;
  installPromise: number;
  installCommand: number;
  seeItWork: number;
  evidence: number;
}

function findAnchors(file: string): ReadmeAnchors {
  const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
  const lines = content.split('\n');

  // Product: the hero heading. It names what the product carries between
  // sessions, not a verdict on any particular idea — this tool does not decide
  // whether a proposal is bad, it decides whether a decision still applies.
  // "Stop re-reviewing the same bad idea" was tried here and moved into the
  // demo: as a hero it implied a judgement `guard` cannot make at 22% recall.
  // #450 replaced the two-line poster heading that used to carry this with a
  // plain problem sentence in the same position. What the amendment pinned —
  // the reader learns what the product is about before anything else — is
  // unchanged; the sentence carrying it is no longer a heading.
  const product = lines.findIndex(
    (l) =>
      l.includes('keeps re-proposing things your team already rejected') ||
      l.includes('이미 기각한 방안을 계속 다시 제안합니다') ||
      l.includes('すでに却下した案を何度も提案します') ||
      l.includes('不断重新提议团队早已否决的方案'),
  );

  // Local-first: "No hosted memory service." or equivalent
  const localFirst = lines.findIndex(
    (l) =>
      l.includes('without a hosted service') ||
      l.includes('호스팅 서비스 없이') ||
      l.includes('ホスティングサービスなしで') ||
      l.includes('无需托管服务'),
  );

  // Install promise: "Install once." or equivalent
  const installPromise = lines.findIndex(
    (l) =>
      l.includes('Install once.') ||
      l.includes('한 번 설치한다') ||
      l.includes('一度インストールします') ||
      l.includes('安装一次'),
  );

  // Install command: the curl block
  const installCommand = lines.findIndex((l) =>
    l.includes('curl -fsSL https://raw.githubusercontent.com/MongLong0214/commitlore/'),
  );

  // See it work: the section heading
  const seeItWork = lines.findIndex(
    (l) =>
      l === '## See it work' ||
      l === '## 실제로 보기' ||
      l === '## 実際に動かす' ||
      l === '## 看它实际运行',
  );

  // Evidence: the "Retrieval can find records..." heading. It must be the
  // heading and not any line mentioning it — #450 added a contents list whose
  // entries name the same sections, and a bare substring search finds the link
  // first, which would compare the wrong position.
  const evidence = lines.findIndex(
    (l) =>
      l.startsWith('## ') &&
      (l.includes('Retrieval can find records') ||
      l.includes('검색은 레코드를 찾을 수 있습니다') ||
      l.includes('検索はレコードを見つけられる') ||
      l.includes('检索能找到记录')),
  );

  return { file, product, localFirst, installPromise, installCommand, seeItWork, evidence };
}

const FILES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh-CN.md'] as const;

describe('T-1015: README section order', () => {
  const allAnchors = FILES.map((f) => findAnchors(f));

  for (const anchors of allAnchors) {
    describe(anchors.file, () => {
      it('all anchors are found', () => {
        expect(anchors.product).toBeGreaterThanOrEqual(0);
        expect(anchors.localFirst).toBeGreaterThanOrEqual(0);
        expect(anchors.installPromise).toBeGreaterThanOrEqual(0);
        expect(anchors.installCommand).toBeGreaterThanOrEqual(0);
        expect(anchors.seeItWork).toBeGreaterThanOrEqual(0);
        expect(anchors.evidence).toBeGreaterThanOrEqual(0);
      });

      it('#167 order preserved: product < local-first < install-promise < install-command', () => {
        expect(anchors.product).toBeLessThan(anchors.localFirst);
        expect(anchors.localFirst).toBeLessThan(anchors.installPromise);
        expect(anchors.installPromise).toBeLessThan(anchors.installCommand);
      });

      it('See it work sits after install command and before evidence', () => {
        expect(anchors.installCommand).toBeLessThan(anchors.seeItWork);
        expect(anchors.seeItWork).toBeLessThan(anchors.evidence);
      });
    });
  }

  it('all four files have consistent relative order', () => {
    // Every file must have the same relative sequence
    for (const anchors of allAnchors) {
      expect(anchors.product).toBeLessThan(anchors.localFirst);
      expect(anchors.localFirst).toBeLessThan(anchors.installPromise);
      expect(anchors.installPromise).toBeLessThan(anchors.installCommand);
      expect(anchors.installCommand).toBeLessThan(anchors.seeItWork);
      expect(anchors.seeItWork).toBeLessThan(anchors.evidence);
    }
  });

  it('BENCH block is present and intact in README.md', () => {
    const content = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    expect(content).toContain('<!-- BENCH:BEGIN -->');
    expect(content).toContain('<!-- BENCH:END -->');
  });

  it('exposure table is present in all files', () => {
    for (const file of FILES) {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      // The exposure table has a "model-visible records" column (or translated equivalent)
      expect(
        content.includes('model-visible records') ||
          content.includes('모델에 보인 레코드') ||
          content.includes('モデルに見えるレコード') ||
          content.includes('模型可见记录'),
      ).toBe(true);
    }
  });
});
