import ts from "typescript";
import { camelPathParamName, parseRoutePath } from "@orval/core";
import type { Operation, Operations } from "./operation.js";
import { upperFirst } from "./naming.js";

/** The single input object of a generated function, e.g. `GetProductInput`. */
export interface OperationInput {
  type: string;
  /** True when every field is optional, so the input may be left out. */
  optional: boolean;
}

/** Input per operation name; null for operations without inputs. */
export type OperationInputs = Map<string, OperationInput | null>;

interface Part {
  type: string;
  optional: boolean;
}

function variableDeclaration(statement: ts.Statement): ts.VariableDeclaration {
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
    throw new Error("Unexpected Orval statement in API output");
  }
  return statement.declarationList.declarations[0];
}

/** The body Orval passes to its fetch call, e.g. `note` for `JSON.stringify(note)`. */
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

function pathParameters(operation: Operation) {
  return operation.parameters.flatMap((parameter) =>
    parameter.in === "path" ? [{ field: parameter.name, variable: parameter.variable! }] : [],
  );
}

function pathExpression(operation: Operation): string {
  const tokens = parseRoutePath(operation.path);
  const names = new Set(pathParameters(operation).map((parameter) => parameter.variable));
  if (!tokens.some((token) => token.kind === "param")) {
    return JSON.stringify(operation.path);
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
      if (!names.has(name)) {
        throw new Error(`Missing path parameter ${token.name} in ${operation.path}`);
      }
      return "${encodeURIComponent(" + name + ")}";
    })
    .join("");
  return "`" + template + "`";
}

/** Orval guards optional multipart fields before appending them. */
function isFormDataAppend(statement: ts.Statement, sourceFile: ts.SourceFile): boolean {
  if (ts.isBlock(statement)) {
    return statement.statements.every((child) => isFormDataAppend(child, sourceFile));
  }
  if (ts.isIfStatement(statement)) {
    return (
      isFormDataAppend(statement.thenStatement, sourceFile) &&
      (!statement.elseStatement || isFormDataAppend(statement.elseStatement, sourceFile))
    );
  }
  return (
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    statement.expression.expression.getText(sourceFile) === "formData.append"
  );
}

/** The statement's text with references to `from` renamed to `to`; property names stay. */
function rename(node: ts.Node, sourceFile: ts.SourceFile, from: string, to: string): string {
  const positions: number[] = [];
  const visit = (child: ts.Node): void => {
    const parent = child.parent;
    if (
      ts.isIdentifier(child) &&
      child.text === from &&
      !(ts.isPropertyAccessExpression(parent) && parent.name === child) &&
      !(ts.isPropertyAssignment(parent) && parent.name === child)
    ) {
      positions.push(child.getStart(sourceFile));
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  const start = node.getStart(sourceFile);
  let text = node.getText(sourceFile);
  for (const position of positions.reverse()) {
    const offset = position - start;
    text = text.slice(0, offset) + to + text.slice(offset + from.length);
  }
  return text;
}

function renderOperation(
  declaration: ts.VariableDeclaration,
  operation: Operation,
  sourceFile: ts.SourceFile,
): { source: string; input: OperationInput | null } {
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
  const orvalCall = last.expression;
  if (
    orvalCall.expression.getText(sourceFile) !== "apiFetch" ||
    orvalCall.arguments.length !== 2 ||
    !ts.isObjectLiteralExpression(orvalCall.arguments[1])
  ) {
    throw new Error(`Unexpected request call in ${name}`);
  }
  const bodyExpression = requestBody(orvalCall.arguments[1], sourceFile);
  const responseType = orvalCall.typeArguments?.[0]?.getText(sourceFile);
  if (!responseType || !arrow.type) {
    throw new Error(`Missing response type in ${name}`);
  }

  // Sort Orval's positional parameters into the fields of one input object.
  const pathFields = new Map(
    pathParameters(operation).map((parameter) => [parameter.variable, parameter.field]),
  );
  const hasQuery = operation.parameters.some((parameter) => parameter.in === "query");
  const hasHeaders = operation.parameters.some((parameter) => parameter.in === "header");
  const path: Array<{ field: string; variable: string; type: string }> = [];
  let query: Part | undefined;
  let headers: Part | undefined;
  let body: (Part & { orvalName: string }) | undefined;
  const parameters = [...arrow.parameters];
  const options = parameters.pop();
  if (!options || options.name.getText(sourceFile) !== "options" || !options.questionToken) {
    throw new Error(`Missing request options in ${name}`);
  }
  for (const parameter of parameters) {
    const parameterName = parameter.name.getText(sourceFile);
    const type = parameter.type?.getText(sourceFile);
    if (!type) {
      throw new Error(`Missing parameter type in ${name}: ${parameterName}`);
    }
    const part = { type, optional: Boolean(parameter.questionToken) };
    const field = pathFields.get(parameterName);
    if (field !== undefined) {
      path.push({ field, variable: parameterName, type });
    } else if (parameterName === "params" && hasQuery && !query) {
      query = part;
    } else if (parameterName === "headers" && hasHeaders && !headers) {
      headers = part;
    } else if (!body && bodyExpression !== undefined) {
      body = { ...part, orvalName: parameterName };
    } else {
      throw new Error(`Unexpected Orval parameter in ${name}: ${parameterName}`);
    }
  }
  if (path.length !== pathFields.size || (hasQuery && !query) || (hasHeaders && !headers)) {
    throw new Error(`Missing parameters in generated operation ${name}`);
  }

  const setup: string[] = [];
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
    if (body && isFormDataAppend(statement, sourceFile)) {
      setup.push(rename(statement, sourceFile, body.orvalName, "body"));
      continue;
    }
    throw new Error(`Unexpected Orval helper in ${name}`);
  }
  let bodyValue: string | undefined;
  if (body) {
    if (bodyExpression === body.orvalName) {
      bodyValue = "body";
    } else if (bodyExpression === "formData" && setup.length) {
      bodyValue = "body: formData";
    } else {
      throw new Error(`Unexpected request body in ${name}: ${bodyExpression}`);
    }
  } else if (bodyExpression !== undefined) {
    throw new Error(`Missing request body parameter in ${name}`);
  }

  const fields = [
    ...path.map((parameter) => `${parameter.field}: ${parameter.type};`),
    ...(headers ? [`headers${headers.optional ? "?" : ""}: ${headers.type};`] : []),
    ...(body ? [`body${body.optional ? "?" : ""}: ${body.type};`] : []),
  ];
  const parts = [
    ...(query ? [query.type] : []),
    ...(fields.length ? [`{ ${fields.join(" ")} }`] : []),
  ];
  const input: OperationInput | null = parts.length
    ? {
        type: `${upperFirst(name)}Input`,
        optional:
          !path.length &&
          (!query || query.optional) &&
          (!headers || headers.optional) &&
          (!body || body.optional),
      }
    : null;

  const names = path.map(({ field, variable }) =>
    field === variable ? field : `${field}: ${variable}`,
  );
  if (headers) names.push("headers");
  if (body) names.push("body");
  const pattern = !query
    ? `{ ${names.join(", ")} }`
    : names.length
      ? `{ ${names.join(", ")}, ...query }`
      : "query";
  const signature = [
    ...(input ? [`${pattern}: ${input.type}${input.optional ? " = {}" : ""}`] : []),
    "options?: ApiRequestOptions",
  ];

  const request = [
    `method: ${JSON.stringify(operation.method.toUpperCase())}`,
    `path: ${pathExpression(operation)}`,
    ...(query ? ["query"] : []),
    ...(headers ? ["headers"] : []),
    ...(bodyValue ? [bodyValue] : []),
    // The runtime serializes scalar bodies as JSON only for a JSON media type.
    ...(operation.jsonContentType
      ? [`contentType: ${JSON.stringify(operation.jsonContentType)}`]
      : []),
  ];
  const call = `apiFetch<${responseType}>({ ${request.join(", ")} }, options)`;
  const returnType = arrow.type.getText(sourceFile);
  const fn = setup.length
    ? `export const ${name} = (${signature.join(", ")}): ${returnType} => {
        ${setup.join("\n")}
        return ${call};
      };`
    : `export const ${name} = (${signature.join(", ")}): ${returnType} => ${call};`;
  const source = input ? `export type ${input.type} = ${parts.join(" & ")};\n\n${fn}` : fn;
  return { source, input };
}

export function renderApi(
  source: string,
  operations: Operations,
  header: string,
  requestImport: string,
): { source: string; inputs: OperationInputs } {
  const sourceFile = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
  const modelImport = sourceFile.statements.find(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /^\.\/api\.schemas(?:\.js)?$/.test(statement.moduleSpecifier.text),
  );
  const functions = [];
  const inputs: OperationInputs = new Map();
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
    const rendered = renderOperation(declaration, operation, sourceFile);
    inputs.set(name, rendered.input);
    functions.push(rendered.source);
  }
  if (inputs.size !== operations.size) {
    throw new Error(`Expected ${operations.size} API operations, generated ${inputs.size}`);
  }

  return {
    source: [
      header,
      ...(modelImport
        ? [modelImport.getText(sourceFile).replace(/\.\/api\.schemas(?:\.js)?/, "./models")]
        : []),
      `import { apiFetch, type ApiRequestOptions } from ${JSON.stringify(requestImport)};`,
      ...functions,
      "",
    ].join("\n\n"),
    inputs,
  };
}
