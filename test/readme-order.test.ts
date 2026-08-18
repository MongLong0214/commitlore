/**
 * T-1015 (#207, #547): README first-screen order. A new reader gets the
 * recognizable problem, installation, the actual payload, the delivery/capture
 * boundary, limitations, then evidence — in that order in all four languages.
 *
 * Binding anchors from the CEO amendment. #450 restructured the opening, so
 * two anchors point at the sentences that carry those properties rather than
 * at the wording they had before. #547 deliberately extends the required
 * order to make the automatic boundary and limitations visible before the
 * evidence section. The anchors still stand for:
 *   product  → the opening problem sentence (was: the hero heading)
 *   local-first → the accurate no-hosted-service data-flow sentence
 *   install promise → "Install once."
 *   install command → the `curl` block
 *   automatic → the heading that distinguishes delivery from capture
 *   limitations → the heading that says when this will not help
 *   evidence → "Retrieval can find records. Path scope keeps reversed decisions out."
 *
 * The required order is:
 *   product < local-first < install-promise < install-command < payload
 *   < automatic-boundary < limitations < evidence
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
  automaticBoundary: number;
  limitations: number;
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

  // Local-first: the opening states the scope accurately. CommitLore has no
  // hosted service, but a host can handle returned context under its own policy.
  const localFirst = lines.findIndex(
    (l) =>
      l.includes('CommitLore has no hosted service') ||
      l.includes('CommitLore에는 호스팅 서비스가 없') ||
      l.includes('CommitLore にホスティングサービスは') ||
      l.includes('CommitLore 没有托管服务'),
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

  // The table heading, rather than an incidental mention of delivery or
  // capture. A previous anchor regression matched the contents link instead
  // of a heading; keep every heading lookup exact for the same reason.
  const automaticBoundary = lines.findIndex(
    (l) =>
      l === '## What happens automatically — and what does not' ||
      l === '## 자동으로 되는 것과 아닌 것' ||
      l === '## 自動になること、ならないこと' ||
      l === '## 哪些是自动的，哪些不是',
  );

  const limitations = lines.findIndex(
    (l) =>
      l === '## When this will not help you' ||
      l === '## 이것이 도움이 되지 않는 경우' ||
      l === '## これが役に立たない場合' ||
      l === '## 这在什么情况下帮不上忙',
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

  return {
    file,
    product,
    localFirst,
    installPromise,
    installCommand,
    seeItWork,
    automaticBoundary,
    limitations,
    evidence,
  };
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
        expect(anchors.automaticBoundary).toBeGreaterThanOrEqual(0);
        expect(anchors.limitations).toBeGreaterThanOrEqual(0);
        expect(anchors.evidence).toBeGreaterThanOrEqual(0);
      });

      it('#167 order preserved: product < local-first < install-promise < install-command', () => {
        expect(anchors.product).toBeLessThan(anchors.localFirst);
        expect(anchors.localFirst).toBeLessThan(anchors.installPromise);
        expect(anchors.installPromise).toBeLessThan(anchors.installCommand);
      });

      it('the first screen delivers payload, automation boundary, limits, then evidence', () => {
        expect(anchors.installCommand).toBeLessThan(anchors.seeItWork);
        expect(anchors.seeItWork).toBeLessThan(anchors.automaticBoundary);
        expect(anchors.automaticBoundary).toBeLessThan(anchors.limitations);
        expect(anchors.limitations).toBeLessThan(anchors.evidence);
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
      expect(anchors.seeItWork).toBeLessThan(anchors.automaticBoundary);
      expect(anchors.automaticBoundary).toBeLessThan(anchors.limitations);
      expect(anchors.limitations).toBeLessThan(anchors.evidence);
    }
  });

  it('BENCH block is present and intact where it lives, and nowhere else', () => {
    // It lived in README.md, and in the other three, and only the first was
    // ever regenerated against the logs -- `check-readme-numbers.mjs` took
    // `readmes[0]` and stopped. `docs/evidence.md` owns it now; a README that
    // grows one again is a second copy of a generated artifact.
    const evidence = fs.readFileSync(path.join(REPO_ROOT, 'docs/evidence.md'), 'utf8');
    expect(evidence).toContain('<!-- BENCH:BEGIN -->');
    expect(evidence).toContain('<!-- BENCH:END -->');

    for (const file of FILES) {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      expect(content, `${file} carries a second copy of the generated block`).not.toContain(
        '<!-- BENCH:BEGIN -->',
      );
    }
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

  it('the first screen names delivery and capture for every host class', () => {
    for (const file of FILES) {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      expect(content).toContain('| Host | Delivery | Capture |');
      expect(content).toContain('| Claude Code |');
      expect(content).toContain('| Codex |');
      expect(content).toContain('| Hermes |');
      expect(content).toContain('commitlore hermes install');
      expect(content).toContain('AGENTS.md');
    }
  });

  it('distinguishes clone-carried trailers from notes-backed records in every file', () => {
    for (const file of FILES) {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      expect(content).toContain('refs/notes/*');
    }
  });

  it('does not claim that returned context remains inside the repository', () => {
    const oldClaims = [
      'single byte leaving your repository',
      '저장소 밖으로 단 1바이트도',
      'リポジトリの外へ 1 バイトも',
      '不会有一个字节离开你的仓库',
    ];
    const hostPolicy = [
      /under its own\s+policy/,
      /자신의 정책에 따라/,
      /自身のポリシーで/,
      /按自己的政策/,
    ];

    for (const [index, file] of FILES.entries()) {
      const content = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      expect(content).not.toContain(oldClaims[index]!);
      expect(content).toMatch(hostPolicy[index]!);
    }
  });
});
