import type { TemplateResult } from "lit";
import type { Guard } from "./guard.js";

export type Params = Record<string, string | undefined>;

export interface PageDef {
  /** URLPattern pathname syntax, e.g. `/browsers/:id`. */
  path: string;
  /** Returns the page element for the matched params. */
  render: (params: Params) => TemplateResult;
  /** Lazy import of the page module, run before the page is rendered. */
  load?: () => Promise<unknown>;
  title?: string | ((ctx: { params: Params }) => string);
  guards?: Guard[];
}

/** Identity function for type inference and readability. Validation happens in `createApp`. */
export const definePage = (def: PageDef): PageDef => Object.freeze(def);
