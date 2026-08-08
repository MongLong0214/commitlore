/**
 * Structural guard for the doctor check seam.
 *
 * The registry declares relationships between independently owned checks; this
 * test walks every check module's import edges so a future direct sibling import
 * cannot quietly reintroduce the coupling the split was made to remove.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  createSourceFile,
  forEachChild,
  isExportDeclaration,
  isImportDeclaration,
  ScriptTarget,
} from 'typescript';

const CHECKS_DIRECTORY = fileURLToPath(new URL('../src/commands/doctor/checks/', import.meta.url));

const importedModuleSpecifiers = (path: string): string[] => {
  const source = createSourceFile(path, readFileSync(path, 'utf8'), ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  forEachChild(source, (node) => {
    if (isImportDeclaration(node) || isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier !== undefined && specifier.text.startsWith('.')) specifiers.push(specifier.text);
    }
  });

  return specifiers;
};

describe('#467 doctor check module boundaries', () => {
  it('does not allow a check module to import a sibling check module', () => {
    const checkModules = readdirSync(CHECKS_DIRECTORY)
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => resolve(CHECKS_DIRECTORY, entry));

    for (const module of checkModules) {
      for (const specifier of importedModuleSpecifiers(module)) {
        const imported = resolve(dirname(module), specifier.replace(/\.js$/, '.ts'));
        const importedFromChecks = relative(CHECKS_DIRECTORY, imported);

        expect(
          importedFromChecks === '' || (!importedFromChecks.startsWith('..') && !importedFromChecks.startsWith('/')),
          `${relative(CHECKS_DIRECTORY, module)} imports sibling ${specifier}`,
        ).toBe(false);
      }
    }
  });
});
