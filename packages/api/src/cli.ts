#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync, watch as watchDirectory, type FSWatcher } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { createJiti } from "jiti";
import { generate, scaffoldPage } from "./index.js";
import type { CodegenConfig } from "./config.js";

const usage = `Usage: lit-canon-api <command> [--config <file.ts>] [--watch]

Commands:
  generate  Generate the API client, query keys and query/mutation options.
  check     Compare a fresh generation with the existing client without changing it.
            Exits with code 1 when files are missing, changed or obsolete.
  add-page  Scaffold editable page, shared queries and explicit feature registration.
            --feature <dir> --name <kebab-name> --path </route/:id>
            --query <name=operation> [--bind <name.apiInput=routeParam>]
            Repeat --query and --bind for multiple start queries.

Options:
  -c, --config  Config file (default: lit-canon-api.config.ts).
                Paths in the config are resolved relative to it.
  -w, --watch   With generate: regenerate when the config or a local input file changes.
  -h, --help    Show this help.`;

const commands = ["generate", "check", "add-page"];

function message(error: unknown): string {
  return `lit-canon-api: ${error instanceof Error ? error.message : String(error)}`;
}

async function loadConfig(configPath: string): Promise<CodegenConfig> {
  // Without the module cache, watch mode sees each saved version of the config.
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return jiti.import<CodegenConfig>(configPath, { default: true });
}

async function run(configPath: string, config: CodegenConfig, check: boolean): Promise<void> {
  const result = await generate(config, { cwd: dirname(configPath), check });
  const count = result.tags.length;
  console.log(
    `${check ? "Client is current" : "Generated client"}: ${result.output} (${count} ${count === 1 ? "resource" : "resources"})`,
  );
}

/** Regenerates on changes to the config or a local input file until the process ends. */
function watch(configPath: string): void {
  let watchers: FSWatcher[] = [];
  let watched = "";
  let running = false;
  let pending = false;
  let timer: NodeJS.Timeout | undefined;

  const follow = (files: string[]) => {
    const key = files.join("\n");
    if (key === watched) {
      return;
    }
    watchers.forEach((watcher) => watcher.close());
    watched = key;
    // Watch the directories: editors often save by replacing the file.
    const directories = new Map<string, Set<string>>();
    for (const file of files) {
      const names = directories.get(dirname(file)) ?? new Set<string>();
      directories.set(dirname(file), names.add(basename(file)));
    }
    watchers = [...directories].map(([directory, names]) =>
      watchDirectory(directory, (_event, name) => {
        if (name && names.has(name)) {
          clearTimeout(timer);
          timer = setTimeout(() => void rebuild(), 100);
        }
      }),
    );
  };

  const rebuild = async (): Promise<void> => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    const files = [configPath];
    try {
      const config = await loadConfig(configPath);
      if (typeof config?.input === "string" && !/^https?:\/\//i.test(config.input)) {
        files.push(resolve(dirname(configPath), config.input));
      }
      await run(configPath, config, false);
    } catch (error) {
      console.error(message(error));
    }
    follow(files);
    console.log("Watching for changes…");
    running = false;
    if (pending) {
      pending = false;
      await rebuild();
    }
  };

  void rebuild();
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c", default: "lit-canon-api.config.ts" },
      watch: { type: "boolean", short: "w", default: false },
      help: { type: "boolean", short: "h", default: false },
      feature: { type: "string" },
      name: { type: "string" },
      path: { type: "string" },
      query: { type: "string", multiple: true, default: [] },
      bind: { type: "string", multiple: true, default: [] },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help) {
    console.log(usage);
  } else if (
    !commands.includes(command) ||
    rest.length ||
    (values.watch && command !== "generate")
  ) {
    const problem =
      command === undefined
        ? "Missing command."
        : !commands.includes(command)
          ? `Unknown command "${command}".`
          : rest.length
            ? `Unexpected argument "${rest[0]}".`
            : "--watch only works with generate.";
    console.error(`lit-canon-api: ${problem}

${usage}`);
    process.exitCode = 1;
  } else {
    const configPath = resolve(values.config);
    if (!existsSync(configPath)) {
      throw new Error(
        `Config file not found: ${configPath}. Create lit-canon-api.config.ts or pass --config <file>.`,
      );
    }
    if (command === "add-page") {
      if (!values.feature || !values.name || !values.path)
        throw new Error("add-page requires --feature, --name and --path");
      const result = await scaffoldPage(await loadConfig(configPath), {
        cwd: dirname(configPath),
        feature: values.feature,
        name: values.name,
        path: values.path,
        queries: values.query,
        bindings: values.bind,
      });
      console.log(`Scaffolded page: ${result.feature} (${result.files.length} editable files)`);
    } else {
      if (values.feature || values.name || values.path || values.query.length || values.bind.length)
        throw new Error("Page options require the add-page command");
      if (values.watch) {
        watch(configPath);
      } else {
        await run(configPath, await loadConfig(configPath), command === "check");
      }
    }
  }
} catch (error) {
  console.error(message(error));
  process.exitCode = 1;
}
