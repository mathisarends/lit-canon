import ts from "typescript";

/** Resource modules and their barrel must not introduce conflicting bindings. */
export function validateExports(sources: Record<string, string>): void {
  const owners = new Map<string, string>();
  for (const [file, source] of Object.entries(sources)) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports = new Set<string>();
    const declarations = new Set<string>();
    for (const statement of ast.statements) {
      if (ts.isImportDeclaration(statement) && statement.importClause) {
        const clause = statement.importClause;
        const bindings = clause.namedBindings;
        const names = [
          ...(clause.name ? [clause.name.text] : []),
          ...(bindings && ts.isNamedImports(bindings)
            ? bindings.elements.map((element) => element.name.text)
            : bindings
              ? [bindings.name.text]
              : []),
        ];
        for (const name of names) {
          if (imports.has(name)) {
            throw new Error(`Duplicate generated module binding: ${name} (${file})`);
          }
          imports.add(name);
        }
      }
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
      const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      let names: string[] = [];
      if (exported && ts.isVariableStatement(statement)) {
        names = statement.declarationList.declarations.flatMap((declaration) =>
          ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
        );
      } else if (
        exported &&
        (ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isFunctionDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name
      ) {
        names = [statement.name.text];
      } else if (
        ts.isExportDeclaration(statement) &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        names = statement.exportClause.elements.map((element) => element.name.text);
      }
      for (const name of names) {
        if (!ts.isExportDeclaration(statement)) {
          declarations.add(name);
        }
        const previous = owners.get(name);
        if (previous && previous !== file) {
          throw new Error(`Duplicate generated resource export: ${name} (${previous} and ${file})`);
        }
        owners.set(name, file);
      }
    }
    for (const name of imports) {
      if (declarations.has(name)) {
        throw new Error(`Duplicate generated module binding: ${name} (${file})`);
      }
    }
  }
}
