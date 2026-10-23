const PREFIX = "[lit-canon]";

/** Human-readable name of a context key created with `createContext`. */
export const contextName = (context: unknown): string =>
  typeof context === "symbol"
    ? (context.description ?? context.toString())
    : typeof context === "string"
      ? `"${context}"`
      : String(context);

export const duplicateFeature = (name: string) =>
  new Error(`${PREFIX} Feature name "${name}" is registered twice.`);

export const duplicatePath = (path: string, first: string, second: string) =>
  new Error(
    `${PREFIX} Path "${path}" is registered twice: in feature "${first}" and in feature "${second}".`,
  );

export const duplicateContext = (context: unknown, first: string, second: string) =>
  new Error(
    `${PREFIX} Context ${contextName(context)} is provided twice: by ${first} and by ${second}.`,
  );

export const tagTaken = (tagName: string) =>
  new Error(
    `${PREFIX} Custom element "${tagName}" is already defined. Pass a different \`rootTagName\` to createApp().`,
  );

export const missingContext = (context: unknown, requester?: string) =>
  new Error(
    requester
      ? `${PREFIX} ${requester} requested context ${contextName(context)}, which is not provided yet. ` +
          `Providers are created in order (app providers, then features in list order); ` +
          `make sure ${contextName(context)} is provided earlier.`
      : `${PREFIX} No provider registered for context ${contextName(context)}.`,
  );

export const notStarted = () =>
  new Error(`${PREFIX} app.navigate() was called before app.start().`);

export const redirectLoop = (to: string, max: number) =>
  `${PREFIX} Aborted navigation: more than ${max} consecutive redirects (last target "${to}").`;

export const guardFailed = (path: string) =>
  `${PREFIX} A guard of page "${path}" threw; navigation aborted.`;

export const loadFailed = (path: string) =>
  `${PREFIX} Failed to load page "${path}"; navigation aborted.`;
