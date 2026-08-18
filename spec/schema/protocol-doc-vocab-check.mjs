#!/usr/bin/env node
// docs/protocol.md 의 어휘표가 SPEC §3과 일치하는지 검사한다.
//
// 표는 사용자가 실제로 보고 쓰는 요약본이다. 표에 스펙에 없는
// 키가 실리면 사용자가 그걸 쓰고 검증기에 거부당한다(`Decision-Id:` 가 실제로 그랬다).
// 반대로 키가 빠지면 그 필드는 존재하지 않는 것과 같다.
//
// 소유자는 네 개의 README가 아니라 docs/protocol.md 하나다 — 같은 표를 네 번
// 반복하면 번역본마다 드리프트 지점이 하나씩 생긴다.
//
// 사용: node spec/schema/protocol-doc-vocab-check.mjs <SPEC.md> <docs/protocol.md>

import fs from 'node:fs';

const [specPath, ...docs] = process.argv.slice(2);
if (!specPath || docs.length === 0) {
  console.error('usage: protocol-doc-vocab-check.mjs <SPEC.md> <docs/protocol.md>');
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

if (specKeys.size === 0) {
  console.error(`${specPath}: 어휘표에서 키를 하나도 뽑지 못했다 — 표 형식이 바뀌었나`);
  process.exit(1);
}

let failed = false;

for (const docPath of docs) {
  const md = fs.readFileSync(docPath, 'utf8');
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

  if (missing.length || extra.length) {
    failed = true;
    console.error(`${docPath}:`);
    if (missing.length) console.error(`  SPEC에 있으나 표에 없음: ${missing.join(', ')}`);
    if (extra.length) console.error(`  표에 있으나 SPEC에 없음: ${extra.join(', ')}`);
  }
}

if (failed) process.exit(1);
console.log(`vocab table matches SPEC (${specKeys.size} keys, owner: ${docs.join(', ')})`);
