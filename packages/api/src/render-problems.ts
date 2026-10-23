import { pascal, sanitize } from "@orval/core";
import type { OpenAPIV3 } from "@scalar/openapi-types";
import type { Operations } from "./operation.js";
import { resolveReference } from "./references.js";

export interface ProblemType {
  name: string;
  hasCode: boolean;
}

function hasCode(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  spec: OpenAPIV3.Document,
  seen = new Set<object>(),
): boolean {
  const resolved = resolveReference(schema, spec, "Schemas");
  if (seen.has(resolved)) {
    return false;
  }
  const visited = new Set(seen).add(resolved);
  if (resolved.properties?.code) {
    return true;
  }
  if (resolved.allOf?.some((member) => hasCode(member, spec, visited))) {
    return true;
  }
  const variants = resolved.oneOf ?? resolved.anyOf;
  return !!variants?.length && variants.every((member) => hasCode(member, spec, visited));
}

export function operationProblems(
  operation: OpenAPIV3.OperationObject,
  spec: OpenAPIV3.Document,
): ProblemType[] {
  const problems = new Map<string, ProblemType>();
  for (const [status, value] of Object.entries(operation.responses ?? {})) {
    if (status.startsWith("2")) {
      continue;
    }
    const response = resolveReference(value, spec, "Responses");
    const schema = response.content?.["application/problem+json"]?.schema;
    if (!schema) {
      continue;
    }
    const references = "$ref" in schema ? [schema] : (schema.oneOf ?? schema.anyOf ?? [schema]);
    for (const reference of references) {
      if (!("$ref" in reference) || !reference.$ref.startsWith("#/components/schemas/")) {
        throw new Error(
          `Problem responses require named local schemas: ${operation.operationId} (${status}). Set problems: false to skip problem helpers.`,
        );
      }
      const rawName = reference.$ref
        .slice("#/components/schemas/".length)
        .replace(/~1/g, "/")
        .replace(/~0/g, "~");
      const name = sanitize(pascal(rawName), {
        underscore: "_",
        whitespace: "_",
        dash: true,
        es5keyword: true,
        es5IdentifierName: true,
      });
      problems.set(name, { name, hasCode: hasCode(reference, spec) });
    }
  }
  return [...problems.values()];
}

function typeName(name: string): string {
  return name[0].toUpperCase() + name.slice(1);
}

function union(members: string[]): string {
  return members.length ? members.join(" | ") : "never";
}

export function renderProblems(
  tag: string,
  operations: Operations,
  header: string,
  requestImport: string,
  includeEmpty = false,
): string | null {
  const problems = [...operations.values()].flatMap((operation) => operation.problems);
  if (!problems.length && !includeEmpty) {
    return null;
  }
  const prefix = typeName(tag.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase()));
  const schemas = [...new Set(problems.map((problem) => problem.name))].sort();
  const operationTypes = [...operations.keys()].map((name) => `${typeName(name)}Problem`);
  const declarations = [
    ...operationTypes,
    `${prefix}Problem`,
    `${prefix}ProblemCode`,
    `is${prefix}Error`,
  ];
  if (
    new Set(declarations).size !== declarations.length ||
    declarations.some((name) => schemas.includes(name) || operations.has(name))
  ) {
    throw new Error(`Problem type conflicts with a generated resource export: ${tag}`);
  }
  const codeType = problems.every((problem) => problem.hasCode)
    ? `${prefix}Problem["code"]`
    : `Extract<${prefix}Problem, { code?: unknown }>["code"]`;
  return [
    header,
    [
      `import { ApiError } from ${JSON.stringify(requestImport)};`,
      ...(schemas.length ? [`import type { ${schemas.join(", ")} } from "./models";`] : []),
    ].join("\n"),
    ...[...operations].map(
      ([name, operation]) =>
        `export type ${typeName(name)}Problem = ${union(operation.problems.map((problem) => problem.name))};`,
    ),
    `export type ${prefix}Problem = ${union(operationTypes)};`,
    `export type ${prefix}ProblemCode = ${codeType};`,
    `export function is${prefix}Error(error: unknown): error is ApiError<${prefix}Problem> {
      return error instanceof ApiError;
    }`,
    "",
  ].join("\n\n");
}
