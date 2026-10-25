import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { format, resolveConfig } from "prettier";
import type { OpenAPIV3 } from "@scalar/openapi-types";
import { validateConfig, type CodegenConfig } from "./config.js";
import { hasErrorCode, isWithin } from "./files.js";
import { collectOperations, identifier, operationName } from "./openapi.js";
import { operationInputs } from "./render-queries.js";

export interface PageScaffoldOptions {
  /** Existing config paths and feature paths are relative to this directory. */
  cwd?: string;
  /** Feature directory, e.g. src/features/products. */
  feature: string;
  /** Local kebab-case page name, e.g. detail. */
  name: string;
  /** Simple pathname with required /:param segments. */
  path: string;
  /** Named start queries: product=get_product. */
  queries: string[];
  /** Explicit bindings: product.productId=id (API input = route param). */
  bindings?: string[];
}

function pairs(values: string[], label: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const value of values) {
    const parts = value.split("=");
    if (parts.length !== 2 || !parts[0] || !parts[1] || entries.has(parts[0])) {
      throw new Error(`Invalid or duplicate ${label}: ${value}`);
    }
    entries.set(parts[0], parts[1]);
  }
  return entries;
}

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascal = (name: string) => {
  const value = camel(name);
  return value[0].toUpperCase() + value.slice(1);
};
const modulePath = (from: string, to: string) => {
  const path = relative(dirname(from), to).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
};

async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

/** Do not follow symlinks/junctions when creating application files. */
async function validateParents(path: string) {
  for (let current = path; ; current = dirname(current)) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error(`Scaffold parent must be a regular directory: ${current}`);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
    }
    if (dirname(current) === current) return;
  }
}

function register(source: string, page: string, routeImport: string): string {
  const file = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
  // Refuse an existing inline page or import with the new descriptor's name.
  for (const statement of file.statements) {
    const names: string[] = [];
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        names.push(declaration.name.getText(file));
    } else if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name) names.push(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        names.push(...bindings.elements.map((e) => e.name.text));
      else if (bindings) names.push(bindings.name.text);
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      names.push(statement.name.text);
    }
    if (names.includes(page))
      throw new Error(`Feature index already declares ${page}; choose another page name`);
  }
  const arrays: ts.ArrayLiteralExpression[] = [];
  for (const statement of file.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call) || call.expression.getText(file) !== "defineFeature")
        continue;
      const object = call.arguments[0];
      if (!object || !ts.isObjectLiteralExpression(object)) continue;
      const pages = object.properties.find(
        (p) => ts.isPropertyAssignment(p) && p.name.getText(file) === "pages",
      );
      if (pages && ts.isPropertyAssignment(pages) && ts.isArrayLiteralExpression(pages.initializer))
        arrays.push(pages.initializer);
    }
  }
  if (arrays.length !== 1)
    throw new Error(
      "Feature index must export one defineFeature with an explicit pages array; register the page manually otherwise.",
    );
  const array = arrays[0];
  if (array.elements.some((element) => element.getText(file) === page))
    throw new Error(`Page already registered: ${page}`);
  const insertAt = array.end - 1;
  const comma = array.elements.length && !array.elements.hasTrailingComma ? "," : "";
  return (
    `import { ${page} } from ${JSON.stringify(routeImport)};\n` +
    source.slice(0, insertAt) +
    `${comma}\n${page},\n` +
    source.slice(insertAt)
  );
}

/** One-time application scaffold. API regeneration never owns or replaces these files. */
export async function scaffoldPage(config: CodegenConfig, options: PageScaffoldOptions) {
  validateConfig(config);
  const cwd = resolve(options.cwd ?? process.cwd());
  const feature = resolve(cwd, options.feature);
  const generated = resolve(cwd, config.output);
  if (
    !isWithin(cwd, feature) ||
    feature === cwd ||
    isWithin(generated, feature) ||
    isWithin(feature, generated)
  ) {
    throw new Error("Feature must be inside the project and outside the generated API directory");
  }
  const featureName = basename(feature);
  for (const value of [featureName, options.name]) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value))
      throw new Error(`Expected a kebab-case feature/page name: ${value}`);
  }
  if (
    !/^\/(?:[A-Za-z0-9_-]+|:[A-Za-z_]\w*)?(?:\/(?:[A-Za-z0-9_-]+|:[A-Za-z_]\w*))*$/.test(
      options.path,
    )
  ) {
    throw new Error("Page scaffolding supports simple paths with required /:param segments");
  }
  const params = [...options.path.matchAll(/:([A-Za-z_]\w*)/g)].map((m) =>
    identifier(m[1], "route parameter"),
  );
  if (new Set(params).size !== params.length) throw new Error("Duplicate route parameter");
  if (params.some((param) => ["__proto__", "constructor", "prototype"].includes(param)))
    throw new Error("Reserved route parameter");
  const queries = pairs(options.queries, "query");
  if (!queries.size) throw new Error("At least one --query name=operation is required");
  const bindings = pairs(options.bindings ?? [], "binding");
  const usedBindings = new Set<string>();
  const spec = JSON.parse(await readFile(resolve(cwd, config.input), "utf8")) as OpenAPIV3.Document;
  const { operationsByTag, mutationOperations } = collectOperations(spec, config);
  const imports = new Set<string>();
  const members: string[] = [];
  for (const [key, id] of queries) {
    identifier(key, "query name");
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error(`Reserved query name: ${key}`);
    const name = operationName(id);
    const resource = [...operationsByTag].find(([, operations]) => operations.has(name));
    if (!resource || resource[1].get(name)!.method !== "get" || mutationOperations.includes(name)) {
      throw new Error(`Scaffold query must be an included read operation: ${id}`);
    }
    const tag = resource[0];
    const namespace = camel(tag);
    const source = await readFile(resolve(generated, tag, "api.ts"), "utf8");
    const inputs = operationInputs(source).get(name);
    if (!inputs) throw new Error(`Generate the API client before scaffolding: ${name}`);
    const args: string[] = [];
    for (const input of inputs) {
      const binding = `${key}.${input.name}`;
      const param = bindings.get(binding);
      if (param !== undefined) {
        if (!params.includes(param))
          throw new Error(`Unknown route parameter in ${binding}: ${param}`);
        if (input.sourceType !== "string")
          throw new Error(
            `Binding ${binding} needs a string API input; add other conversions in application code`,
          );
        usedBindings.add(binding);
        args.push(`params.${param}`);
      } else if (input.optional) args.push("undefined");
      else throw new Error(`Missing --bind ${binding}=<route-param>`);
    }
    while (args.at(-1) === "undefined") args.pop();
    imports.add(namespace);
    members.push(
      `${key}: queryOptions({ ...${namespace}.${name}Query(${args.join(", ")}), staleTime: 30_000 })`,
    );
  }
  for (const binding of bindings.keys())
    if (!usedBindings.has(binding)) throw new Error(`Unused binding: ${binding}`);

  const stem = `${featureName}-${options.name}`;
  const page = camel(stem);
  const className = `${pascal(stem)}Page`;
  const paramsType = `${pascal(stem)}Params`;
  const factory = `${page}Queries`;
  if (["queryOptions", factory, paramsType].some((name) => imports.has(name)))
    throw new Error("Resource namespace conflicts with a scaffold import or declaration");
  const tag = `${stem}-page`;
  const indexFile = resolve(feature, "index.ts");
  const routeFile = resolve(feature, `${options.name}.route.ts`);
  const queryFile = resolve(feature, "pages", `${options.name}.queries.ts`);
  const componentFile = resolve(feature, "pages", `${options.name}-page.ts`);
  await validateParents(dirname(queryFile));
  for (const path of [routeFile, queryFile, componentFile]) {
    if (await exists(path)) throw new Error(`Refusing to overwrite application file: ${path}`);
  }
  if ((await exists(indexFile)) && (await lstat(indexFile)).isSymbolicLink())
    throw new Error("Feature index must not be a symlink");
  const previousIndex = (await exists(indexFile)) ? await readFile(indexFile, "utf8") : undefined;
  const index =
    previousIndex === undefined
      ? `import { defineFeature } from "lit-canon-composition";\nimport { ${page} } from "./${options.name}.route.js";\nexport const ${camel(featureName)}Feature = defineFeature({ name: ${JSON.stringify(featureName)}, pages: [${page}] });`
      : register(previousIndex, page, `./${options.name}.route.js`);
  const header = "// Scaffolded by lit-canon-api. Application code: edit freely.\n";
  const files = new Map<string, string>([
    [
      queryFile,
      `${header}
import type { PageParams } from "lit-canon-composition";
import { queryOptions } from "@tanstack/lit-query";
import { ${[...imports].join(", ")} } from ${JSON.stringify(modulePath(queryFile, resolve(generated, "index.js")))};
export type ${paramsType} = PageParams<${JSON.stringify(options.path)}>;
export const ${factory} = (${usedBindings.size ? "params" : "_params"}: ${paramsType}) => ({ ${members.join(",\n")} });`,
    ],
    [
      routeFile,
      `${header}
import { html } from "lit";
import { definePage } from "lit-canon-composition";
import { prefetchQueries } from "lit-canon-composition/query";
import { ${factory} } from "./pages/${options.name}.queries.js";
export const ${page} = definePage({
  path: ${JSON.stringify(options.path)},
  load: () => import("./pages/${options.name}-page.js"),
  prefetch: prefetchQueries(({ params }) => ${factory}(params)),
  render: (params) => html\`<${tag} .params=\${params}></${tag}>\`,
});`,
    ],
    [
      componentFile,
      `${header}
import { LitElement, html } from "lit";
import { createQueryController } from "@tanstack/lit-query";
import { ${factory}, type ${paramsType} } from "./${options.name}.queries.js";
export class ${className} extends LitElement {
  static override properties = { params: { attribute: false } };
  params: ${paramsType} = { ${params.map((p) => `${p}: ""`).join(", ")} };
  ${[...queries.keys()].map((key) => `private readonly ${key}Query = createQueryController(this, () => ({ ...${factory}(this.params).${key}, enabled: Object.values(this.params).every(Boolean) }));`).join("\n")}
  protected override render() {
    ${[...queries.keys()].map((key) => `const ${key}Result = this.${key}Query();\nif (${key}Result.isPending) return html\`<p>Loading…</p>\`;\nif (${key}Result.isError) return html\`<p role="alert">\${${key}Result.error.message}</p>\`;`).join("\n")}
    // Replace this initial representation with the page's domain UI.
    return html\`<pre>\${JSON.stringify({ ${[...queries.keys()].map((key) => `${key}: ${key}Result.data`).join(", ")} }, null, 2)}</pre>\`;
  }
}
customElements.define(${JSON.stringify(tag)}, ${className});`,
    ],
    [indexFile, index],
  ]);
  const prettier = {
    ...(await resolveConfig(resolve(cwd, "lit-canon-api.config.ts"))),
    ...config.prettier,
  };
  for (const [file, source] of files)
    files.set(file, await format(source, { ...prettier, filepath: file, parser: "typescript" }));
  const created: string[] = [];
  try {
    await mkdir(dirname(queryFile), { recursive: true });
    for (const [file, source] of files) {
      if (file === indexFile && previousIndex !== undefined) continue;
      await writeFile(file, source, { flag: "wx" });
      created.push(file);
    }
    if (previousIndex !== undefined) {
      if ((await readFile(indexFile, "utf8")) !== previousIndex)
        throw new Error("Feature index changed during scaffolding; retry");
      await writeFile(indexFile, files.get(indexFile)!);
    }
  } catch (error) {
    for (const file of created.reverse()) await unlink(file);
    throw error;
  }
  return { feature, files: [...files.keys()] };
}
