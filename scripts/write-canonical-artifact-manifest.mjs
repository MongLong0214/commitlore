#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { artifactManifest, manifestPath } from './canonical-artifact-contract.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const path = manifestPath(root);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify(artifactManifest(root), null, 2)}\n`);
process.stdout.write(`wrote ${path}\n`);
