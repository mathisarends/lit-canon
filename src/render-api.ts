import ts from "typescript";
import { camelPathParamName, parseRoutePath } from "@orval/core";
import type { Operation, Operations } from "./operation.js";

function variableDeclaration(statement: ts.Statement): ts.VariableDeclaration {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
    throw new Error("Unexpected Orval statement in API output");
  }
  return statement.declarationList.declarations[0];
}

function requestBody(
  options: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): string | undefined {
  let body: string | undefined;
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property) && property.expression.getText(sourceFile) === "options") {
      continue;
    }
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(`Unexpected Orval request option: ${property.getText(sourceFile)}`);
    }

    const name = property.name.getText(sourceFile);
    if (name === "method") {
      continue;
    }
    if (name === "headers") {
      if (!property.initializer.getText(sourceFile).includes("getHeaders(options?.headers)")) {
        throw new Error("Unexpected Orval headers in API output");
      }
      continue;
    }
    if (name === "body") {
      const expression = property.initializer;
      body =
        ts.isCallExpression(expression) &&
        expression.expression.getText(sourceFile) === "JSON.stringify"
          ? expression.arguments[0].getText(sourceFile)
          : expression.getText(sourceFile);
      continue;
    }
    throw new Error(`Unexpected Orval request option: ${name}`);
  }
  return body;
}

function urlExpression(path: string, parameterNames: Set<string>): string {
  const tokens = parseRoutePath(path);
  if (!tokens.some((token) => token.kind === "param")) {
    return JSON.stringify(path);
  }
  const template = tokens
    .map((token) => {
      if (token.kind === "literal") {
        return JSON.stringify(token.value)
          .slice(1, -1)
          .replace(/`/g, "\\`")
          .replace(/\$\{/g, "\\${");
      }
      const name = camelPathParamName(token.name);
      if (!parameterNames.has(name)) {
        throw new Error(`Missing path parameter ${token.name} in ${path}`);
      }
      return "${encodeURIComponent(" + name + ")}";
    })
    .join("");
  return "`" + template + "`";
}

function renderOperation(
  declaration: ts.VariableDeclaration,
  operation: Operation,
  sourceFile: ts.SourceFile,
): string {
  const name = declaration.name.getText(sourceFile);
  const arrow = declaration.initializer;
  if (!arrow || !ts.isArrowFunction(arrow) || !ts.isBlock(arrow.body)) {
    throw new Error(`Unexpected Orval operation: ${name}`);
  }

  const statements = arrow.body.statements;
  const last = statements.at(-1);
  if (
    !last ||
    !ts.isReturnStatement(last) ||
    !last.expression ||
    !ts.isCallExpression(last.expression)
  ) {
    throw new Error(`Missing API fetch call in ${name}`);
  }
  const setup = [];
  for (const statement of statements.slice(0, -1)) {
    if (ts.isVariableStatement(statement)) {
      const helper = variableDeclaration(statement);
      const helperName = helper.name.getText(sourceFile);
      if (helperName === "getHeaders") {
        continue;
      }
      if (
        helperName === "formData" &&
        helper.initializer?.getText(sourceFile) === "new FormData()"
      ) {
        setup.push(statement.getText(sourceFile));
        continue;
      }
    }
    if (
      ts.isExpressionStatement(statement) &&
      ts.isCallExpression(statement.expression) &&
      statement.expression.expression.getText(sourceFile) === "formData.append"
    ) {
      setup.push(statement.getText(sourceFile));
      continue;
    }
    throw new Error(`Unexpected Orval helper in ${name}`);
  }

  const call = last.expression;
  if (call.expression.getText(sourceFile) !== "apiFetch" || call.arguments.length !== 2) {
    throw new Error(`Unexpected request call in ${name}`);
  }
  const options = call.arguments[1];
  if (!ts.isObjectLiteralExpression(options)) {
    throw new Error(`Missing request options in ${name}`);
  }
  const body = requestBody(options, sourceFile);
  const parameterNames = new Set(
    arrow.parameters.map((parameter) => parameter.name.getText(sourceFile)),
  );
  const useRequestName = body && parameterNames.has(body) && !parameterNames.has("request");
  const parameters = arrow.parameters.map((parameter) => {
    let text = parameter
      .getText(sourceFile)
      .replace("Parameters<typeof apiFetch>[1]", "ApiRequestOptions");
    if (useRequestName && parameter.name.getText(sourceFile) === body) {
      text = `request${text.slice(body.length)}`;
    }
    return text;
  });
  const url = urlExpression(operation.path, parameterNames);
  const fetchOptions = [`...options`, `method: ${JSON.stringify(operation.method.toUpperCase())}`];
  if (operation.hasQuery) {
    if (!parameterNames.has("params")) {
      throw new Error(`Missing query params in ${name}`);
    }
    fetchOptions.push("query: params");
  }
  if (body) {
    fetchOptions.push(`body: ${useRequestName ? "request" : body}`);
  }

  const responseType = call.typeArguments?.[0]?.getText(sourceFile);
  if (!responseType || !arrow.type) {
    throw new Error(`Missing response type in ${name}`);
  }
  if (!setup.length) {
    return `export const ${name} = (${parameters.join(", ")}): ${arrow.type.getText(sourceFile)} =>
      apiFetch<${responseType}>(${url}, { ${fetchOptions.join(", ")} });`;
  }
  return `export const ${name} = (${parameters.join(", ")}): ${arrow.type.getText(sourceFile)} => {
    ${setup.join("\n")}
    return apiFetch<${responseType}>(${url}, { ${fetchOptions.join(", ")} });
  };`;
}

export function renderApi(
  source: string,
  operations: Operations,
  header: string,
  requestImport: string,
): string {
  const sourceFile = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
  const modelImport = sourceFile.statements.find(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /^\.\/api\.schemas(?:\.js)?$/.test(statement.moduleSpecifier.text),
  );
  const functions = [];
  const found = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const declaration = variableDeclaration(statement);
    const name = declaration.name.getText(sourceFile);
    if (!operations.has(name) && name.startsWith("get") && name.endsWith("Url")) {
      continue;
    }
    const operation = operations.get(name);
    if (!operation) {
      throw new Error(`Unknown generated operation: ${name}`);
    }
    found.add(name);
    functions.push(renderOperation(declaration, operation, sourceFile));
  }
  if (found.size !== operations.size) {
    throw new Error(`Expected ${operations.size} API operations, generated ${found.size}`);
  }

  return [
    header,
    ...(modelImport
      ? [modelImport.getText(sourceFile).replace(/\.\/api\.schemas(?:\.js)?/, "./models")]
      : []),
    `import { apiFetch, type ApiRequestOptions } from ${JSON.stringify(requestImport)};`,
    ...functions,
    "",
  ].join("\n\n");
}
