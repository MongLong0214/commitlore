/**
 * Structural reads of a candidate tree, for oracles that must not be fooled by
 * prose (§5.3: AST or type-level checks; a regex may be part of a parser but is
 * not scientific authority on its own).
 *
 * The pilot's oracles were substring tests, and in a repository whose practice
 * is recording *why* an approach was rejected, the likeliest thing an honest
 * implementation contains is a comment naming that approach. A grep reads that
 * comment as the approach. A parser does not see it at all.
 *
 * `typescript` is a devDependency and nothing here ships: `bench/` is not in the
 * bundle, so this import costs the product nothing at runtime.
 */

import ts from "typescript";

const parse = (source: string, fileName: string): ts.SourceFile =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);

const eachNode = (node: ts.Node, visit: (n: ts.Node) => void): void => {
  visit(node);
  node.forEachChild((child) => eachNode(child, visit));
};

/**
 * The string-literal members of a named union type alias, or null when the alias
 * is not declared in this source.
 *
 * Null and empty are different answers: null means the declaration was not found
 * — which is the oracle's cue that it is looking at the wrong file rather than
 * at a union someone emptied.
 */
export const unionMembers = (source: string, aliasName: string): readonly string[] | null => {
  if (source.trim() === "") return null;
  let found: readonly string[] | null = null;
  eachNode(parse(source, `${aliasName}.ts`), (node) => {
    if (!ts.isTypeAliasDeclaration(node) || node.name.text !== aliasName) return;
    const type = node.type;
    const parts = ts.isUnionTypeNode(type) ? type.types : [type];
    found = parts.flatMap((part) =>
      ts.isLiteralTypeNode(part) && ts.isStringLiteral(part.literal) ? [part.literal.text] : [],
    );
  });
  return found;
};

/** Property names declared on a named interface, or null when it is not there. */
export const interfaceProperties = (source: string, interfaceName: string): readonly string[] | null => {
  if (source.trim() === "") return null;
  let found: readonly string[] | null = null;
  eachNode(parse(source, `${interfaceName}.ts`), (node) => {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== interfaceName) return;
    found = node.members.flatMap((member) =>
      ts.isPropertySignature(member) && ts.isIdentifier(member.name) ? [member.name.text] : [],
    );
  });
  return found;
};

/**
 * Every distinct string literal the module assigns to an exported `const`, keyed
 * by the const's name. A flag surface that gains a second value shows up here;
 * a comment describing one does not.
 */
export const exportedStringConstants = (source: string): Readonly<Record<string, string>> => {
  const out: Record<string, string> = {};
  if (source.trim() === "") return out;
  eachNode(parse(source, "consts.ts"), (node) => {
    if (!ts.isVariableStatement(node)) return;
    const exported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
    if (!exported) return;
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      const init = decl.initializer;
      if (init !== undefined && ts.isStringLiteral(init)) out[decl.name.text] = init.text;
    }
  });
  return out;
};
