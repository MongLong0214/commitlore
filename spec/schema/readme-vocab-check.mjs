#!/usr/bin/env node
// README의 어휘표가 SPEC §3과 일치하는지 검사한다.
//
// 이 프로젝트에서 README는 마케팅 문서가 아니라 스펙의 요약본이다. 표에 스펙에 없는
// 키가 실리면 사용자가 그걸 쓰고 검증기에 거부당한다(`Decision-Id:` 가 실제로 그랬다).
// 반대로 키나 값 문법이 빠지면 그 필드는 존재하지 않는 것과 같다. 특히
// `Provenance:`의 값은 제품이 실제로 쓰는 trust grade이므로 `drafted`나
// `unknown`을 표가 생략하면 사용자는 존재하지 않는 값을 보게 된다.
//
// 사용: node spec/schema/readme-vocab-check.mjs <SPEC.md> <README.md> [README.*.md ...]

import fs from 'node:fs';

const [specPath, ...readmes] = process.argv.slice(2);
if (!specPath || readmes.length === 0) {
  console.error('usage: readme-vocab-check.mjs <SPEC.md> <README.md> [more...]');
  process.exit(2);
}

/** SPEC §3의 어휘표에서 키를 뽑는다. `| \`Key:\` | ...` 형태의 행만 센다. */
const specKeys = (() => {
  const spec = fs.readFileSync(specPath, 'utf8');
  const section = spec.split(/^## /m).find((s) => s.startsWith('3. Vocabulary'));
  if (!section) {
    console.error(`${specPath}: "## 3. Vocabulary" 절을 찾지 못했다`);
    process.exit(1);
  }
  const keys = new Set();
  for (const m of section.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9-]*):`/gm)) keys.add(m[1]);
  // `X-<Name>:` 확장은 리터럴 키가 아니라 패턴이므로 별도 취급한다.
  return keys;
})();

/** SPEC §3의 Provenance 값 문법 — 키만 비교하면 값 하나가 빠져도 통과한다. */
const specProvenanceGrammar = (() => {
  const spec = fs.readFileSync(specPath, 'utf8');
  const section = spec.split(/^## /m).find((s) => s.startsWith('3. Vocabulary'));
  const row = section?.match(/^\| `Provenance:` \| (.+) \|/m)?.[1];
  const grammar = row === undefined
    ? undefined
    : [...row.matchAll(/`([^`]+)`/g)].map((match) => match[1]).join(' | ');
  if (grammar === undefined) {
    console.error(`${specPath}: Provenance 값 문법을 찾지 못했다`);
    process.exit(1);
  }
  return grammar;
})();

if (specKeys.size === 0) {
  console.error(`${specPath}: 어휘표에서 키를 하나도 뽑지 못했다 — 표 형식이 바뀌었나`);
  process.exit(1);
}

let failed = false;

for (const readmePath of readmes) {
  const md = fs.readFileSync(readmePath, 'utf8');
  // 어휘표 행에서만 키를 뽑는다. 산문 속 백틱 언급(`feat:` 등)은 세지 않는다.
  const found = new Set();
  for (const m of md.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9-]*):`/gm)) found.add(m[1]);
  // 한 셀에 여러 키를 나열한 행(`A:` / `B:` / `X-*`)도 표 안이면 유효하다.
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    for (const m of line.matchAll(/`([A-Za-z][A-Za-z0-9-]*):`/g)) found.add(m[1]);
  }

  const missing = [...specKeys].filter((k) => !found.has(k));
  const extra = [...found].filter((k) => !specKeys.has(k));
  const provenanceRow = md.match(/^\| `Provenance:` \| (.+) \|$/m)?.[1];
  const readmeProvenanceGrammar = provenanceRow === undefined
    ? undefined
    : [...provenanceRow.matchAll(/`([^`]+)`/g)].map((match) => match[1]).join(' | ');

  if (missing.length || extra.length || readmeProvenanceGrammar !== specProvenanceGrammar) {
    failed = true;
    console.error(`${readmePath}:`);
    if (missing.length) console.error(`  SPEC에 있으나 README 표에 없음: ${missing.join(', ')}`);
    if (extra.length) console.error(`  README 표에 있으나 SPEC에 없음: ${extra.join(', ')}`);
    if (readmeProvenanceGrammar !== specProvenanceGrammar) {
      console.error(`  Provenance 값 문법이 SPEC과 다름: ${readmeProvenanceGrammar ?? '행 없음'}`);
      console.error(`  SPEC: ${specProvenanceGrammar}`);
    }
  }
}

if (failed) process.exit(1);
console.log(`vocab table and Provenance grammar match SPEC (${specKeys.size} keys × ${readmes.length} READMEs)`);
