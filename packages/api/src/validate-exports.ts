import ts from "typescript";

/** A feature barrel must not export the same name from different modules. */
export function validateExports(sources: Record<string, string>): void {
  const owners = new Map<string, string>();
  for (const [file, source] of Object.entries(sources)) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
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
        const previous = owners.get(name);
        if (previous && previous !== file) {
          throw new Error(`Duplicate generated feature export: ${name} (${previous} and ${file})`);
        }
        owners.set(name, file);
      }
    }
  }
}
