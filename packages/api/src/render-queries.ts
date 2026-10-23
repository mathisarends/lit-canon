import ts from "typescript";
import type { FeatureOptions } from "./config.js";
import type { Operations } from "./operation.js";

interface OperationInput {
  name: string;
  optional: boolean;
  type: string;
}

interface RenderQueryOptions {
  feature?: FeatureOptions;
  imports?: string[];
  mutationOperations?: string[];
  aliases?: Record<string, Record<string, string>>;
}

function operationInputs(source: string): Map<string, OperationInput[]> {
  const sourceFile = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
  const inputs = new Map<string, OperationInput[]>();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    if (statement.declarationList.declarations.length !== 1) {
      throw new Error("Unexpected generated API declaration");
    }

    const declaration = statement.declarationList.declarations[0];
    const name = declaration.name.getText(sourceFile);
    const arrow = declaration.initializer;
    if (!arrow || !ts.isArrowFunction(arrow)) {
      throw new Error(`Unexpected generated API operation: ${name}`);
    }

    const parameters = arrow.parameters;
    const options = parameters.at(-1);
    if (!options || options.name.getText(sourceFile) !== "options" || !options.questionToken) {
      throw new Error(`Missing request options in generated API operation: ${name}`);
    }

    inputs.set(
      name,
      parameters.slice(0, -1).map((parameter, index) => ({
        name: parameter.name.getText(sourceFile),
        optional: Boolean(parameter.questionToken),
        type: `Parameters<typeof ${name}>[${index}]`,
      })),
    );
  }

  return inputs;
}

function functionParameters(inputs: OperationInput[]): string {
  return inputs
    .map(({ name, optional, type }) => `${name}${optional ? "?" : ""}: ${type}`)
    .join(", ");
}

function requestOptions(feature: FeatureOptions, signal?: string): string {
  const signalField = signal === "signal" ? "signal" : signal ? `signal: ${signal}` : null;
  const customOptions = feature.requestOptions;
  if (customOptions) {
    const source = ts.createSourceFile(
      "options.ts",
      `(${customOptions})`,
      ts.ScriptTarget.Latest,
      true,
    );
    const statement = source.statements[0];
    const expression =
      statement &&
      ts.isExpressionStatement(statement) &&
      ts.isParenthesizedExpression(statement.expression)
        ? statement.expression.expression
        : undefined;
    if (expression && ts.isObjectLiteralExpression(expression)) {
      const properties = expression.properties.filter((property) => {
        if (!signal || !property.name) {
          return true;
        }
        if (ts.isComputedPropertyName(property.name)) {
          const expression = property.name.expression;
          return !ts.isStringLiteralLike(expression) || expression.text !== "signal";
        }
        const name = property.name;
        return !(ts.isIdentifier(name) || ts.isStringLiteralLike(name)) || name.text !== "signal";
      });
      const canOverrideSignal = properties.some(
        (property) =>
          ts.isSpreadAssignment(property) ||
          (property.name &&
            (ts.isComputedPropertyName(property.name) ||
              property.name.getText(source).replace(/["']/g, "") === "signal")),
      );
      const fieldsSource = properties.map((property) => property.getText(source));
      const fields = canOverrideSignal
        ? [...fieldsSource, signalField]
        : [signalField, ...fieldsSource];
      return `{ ${fields.filter(Boolean).join(", ")} }`;
    }
  }
  const fields = [customOptions ? `...(${customOptions})` : null, signalField];
  return `{ ${fields.filter(Boolean).join(", ")} }`;
}

function usedImports(imports: string[], source: string): string[] {
  const sourceFile = ts.createSourceFile("queries.ts", source, ts.ScriptTarget.Latest, true);
  const used = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      used.add(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return imports.flatMap((source) => {
    const file = ts.createSourceFile("imports.ts", source, ts.ScriptTarget.Latest, true);
    const declaration = file.statements[0];
    if (
      !declaration ||
      !ts.isImportDeclaration(declaration) ||
      !declaration.importClause?.namedBindings ||
      !ts.isNamedImports(declaration.importClause.namedBindings)
    ) {
      throw new Error(`Expected a named feature import: ${source}`);
    }
    const names = declaration.importClause.namedBindings.elements
      .map((element) => element.name.text)
      .filter((name) => used.has(name));
    return names.length
      ? [`import { ${names.join(", ")} } from ${declaration.moduleSpecifier.getText(file)};`]
      : [];
  });
}

function renderQuery(
  tag: string,
  name: string,
  inputs: OperationInput[],
  feature: FeatureOptions,
): string {
  const key = [
    JSON.stringify(tag),
    JSON.stringify(name),
    ...inputs.map(({ name: inputName, optional }) =>
      optional ? `${inputName} ?? null` : inputName,
    ),
    ...(feature.queryKey ?? []),
  ];
  let signalName = "signal";
  const importNames = feature.imports?.flatMap((entry) => entry.names) ?? [];
  while (inputs.some((input) => input.name === signalName) || importNames.includes(signalName)) {
    signalName = `_${signalName}`;
  }
  const call = [
    ...inputs.map(({ name: inputName }) => inputName),
    requestOptions(feature, signalName),
  ];

  return `export const ${name}Query = (${functionParameters(inputs)}) =>
    queryOptions({
      queryKey: [${key.join(", ")}] as const,
      queryFn: ({ ${signalName === "signal" ? "signal" : `signal: ${signalName}`} }) => ${name}(${call.join(", ")}),
      ${feature.enabled ? `enabled: ${feature.enabled},` : ""}
    });`;
}

function renderMutation(
  tag: string,
  name: string,
  inputs: OperationInput[],
  feature: FeatureOptions,
): string {
  const variables =
    inputs.length === 0
      ? ""
      : inputs.length === 1
        ? `variables: ${inputs[0].type}`
        : `variables: [${inputs.map(({ type }) => type).join(", ")}]`;
  const call = [
    ...inputs.map((_, index) => (inputs.length === 1 ? "variables" : `variables[${index}]`)),
    ...(feature.requestOptions ? [requestOptions(feature)] : []),
  ];

  return `export const ${name}Mutation = () =>
    mutationOptions({
      mutationKey: [${JSON.stringify(tag)}, ${JSON.stringify(name)}] as const,
      mutationFn: (${variables}) => ${name}(${call.join(", ")}),
    });`;
}

function renderAliases(
  tag: string,
  queryNames: string[],
  aliases: Record<string, Record<string, string>>,
): string[] {
  return Object.entries(aliases).map(([alias, methods]) => {
    const members = Object.entries(methods).map(([method, operationName]) => {
      if (method === "allKey" || method === "__proto__") {
        throw new Error(`Reserved query alias member: ${alias}.${method}`);
      }
      if (!queryNames.includes(operationName)) {
        throw new Error(`Query alias ${alias}.${method} has no generated operation`);
      }
      const property = /^[A-Za-z_$][\w$]*$/.test(method) ? method : JSON.stringify(method);
      return `${property}: ${operationName}Query,`;
    });
    return `export const ${alias} = {
      allKey: [${JSON.stringify(tag)}] as const,
      ${members.join("\n")}
    };`;
  });
}

export function renderQueryFiles(
  tag: string,
  operations: Operations,
  apiSource: string,
  header: string,
  config: RenderQueryOptions = {},
): { queries: string | null; mutations: string | null } {
  const feature = config.feature ?? {};
  const mutationOperations = new Set(config.mutationOperations ?? []);
  const inputs = operationInputs(apiSource);
  const queryNames: string[] = [];
  const mutationNames: string[] = [];

  for (const [name, operation] of operations) {
    if (!inputs.has(name)) {
      throw new Error(`Missing generated API operation: ${name}`);
    }
    if (operation.method === "get" && !mutationOperations.has(name)) {
      queryNames.push(name);
    } else {
      mutationNames.push(name);
    }
  }
  if (inputs.size !== operations.size) {
    throw new Error(`Unexpected generated operation for ${tag}`);
  }

  const bindings = new Set(operations.keys());
  for (const name of [
    ...queryNames.map((name) => `${name}Query`),
    ...mutationNames.map((name) => `${name}Mutation`),
    ...Object.keys(config.aliases ?? {}),
  ]) {
    if (bindings.has(name)) {
      throw new Error(`Duplicate generated feature export: ${name}`);
    }
    bindings.add(name);
  }
  for (const name of feature.imports?.flatMap((entry) => entry.names) ?? []) {
    if (bindings.has(name) || name === "queryOptions" || name === "mutationOptions") {
      throw new Error(`Feature import conflicts with a generated binding: ${name}`);
    }
    bindings.add(name);
  }

  const queryFunctions = [
    ...queryNames.map((name) => renderQuery(tag, name, inputs.get(name)!, feature)),
    ...renderAliases(tag, queryNames, config.aliases ?? {}),
  ];
  const mutationFunctions = mutationNames.map((name) =>
    renderMutation(tag, name, inputs.get(name)!, feature),
  );
  const queries = queryNames.length
    ? [
        header,
        'import { queryOptions } from "@tanstack/lit-query";',
        ...usedImports(config.imports ?? [], queryFunctions.join("\n")),
        `import { ${queryNames.join(", ")} } from "./api";`,
        ...queryFunctions,
        "",
      ].join("\n\n")
    : null;

  const mutations = mutationNames.length
    ? [
        header,
        'import { mutationOptions } from "@tanstack/lit-query";',
        ...usedImports(config.imports ?? [], mutationFunctions.join("\n")),
        `import { ${mutationNames.join(", ")} } from "./api";`,
        ...mutationFunctions,
        "",
      ].join("\n\n")
    : null;

  return { queries, mutations };
}
