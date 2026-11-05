import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { OpenAPIV3 } from "@scalar/openapi-types";

export function isUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

export async function readInput(input: string): Promise<string> {
  if (!isUrl(input)) {
    return readFile(input, "utf8");
  }
  const response = await fetch(input);
  if (!response.ok) {
    throw new Error(`Could not fetch the OpenAPI input ${input}: HTTP ${response.status}`);
  }
  return response.text();
}

/** JSON documents start with "{"; anything else is read as YAML, a superset of JSON. */
export function isJson(source: string): boolean {
  return source.trimStart().startsWith("{");
}

export function parseInput(source: string, input: string): OpenAPIV3.Document {
  try {
    return (isJson(source) ? JSON.parse(source) : parseYaml(source)) as OpenAPIV3.Document;
  } catch (error) {
    throw new Error(`Could not parse the OpenAPI input ${input}`, { cause: error });
  }
}
