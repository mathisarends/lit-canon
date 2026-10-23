import type { TemplateResult } from "lit";
import type { ProviderDef } from "./container.js";
import type { PageDef } from "./page.js";

/** Wraps every page of a feature. */
export type Layout = (content: TemplateResult) => TemplateResult;

export interface FeatureDef {
  name: string;
  pages: PageDef[];
  layout?: Layout;
  providers?: ProviderDef[];
}

/** Identity function for type inference and readability. Validation happens in `createApp`. */
export const defineFeature = (def: FeatureDef): FeatureDef => Object.freeze(def);
