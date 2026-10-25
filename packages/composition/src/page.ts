import type { TemplateResult } from "lit";
import type { Guard } from "./guard.js";
import type { Container } from "./container.js";

export type Params = Record<string, string | undefined>;

type SegmentParams<S extends string> = S extends `:${infer Name}`
  ? Name extends `${string}${"?" | "*" | "+" | "(" | ")" | "{" | "}" | "." | "-" | ":" | "\\"}${string}`
    ? Params
    : { [K in Name]: string }
  : S extends `${string}${":" | "*" | "(" | "{"}${string}`
    ? Params
    : {};

/** Required names in simple /:param segments; complex URLPatterns retain Params. */
export type PageParams<Path extends string> = string extends Path
  ? Params
  : Path extends `${infer First}/${infer Rest}`
    ? SegmentParams<First> & PageParams<Rest>
    : SegmentParams<Path>;

export interface PrefetchContext<P = Params> {
  params: P;
  path: string;
  url: URL;
  container: Container;
}

export interface PageDef<P = Params> {
  /** URLPattern pathname syntax, e.g. `/browsers/:id`. */
  path: string;
  /** Returns the page element for the matched params. */
  render(params: P): TemplateResult;
  /** Lazy import of the page module, run before the page is rendered. */
  load?: () => Promise<unknown>;
  title?: string | { call(ctx: { params: P }): string }["call"];
  guards?: Guard[];
  /** Cache warming on intent and permitted navigation; never blocks. Errors are ignored. */
  prefetch?(ctx: PrefetchContext<P>): void | Promise<unknown>;
  /** Side-effect-free permission check. Guarded pages otherwise skip intent prefetching. */
  canPrefetch?(ctx: PrefetchContext<P>): boolean | Promise<boolean>;
}

/** Identity function for type inference and readability. Validation happens in `createApp`. */
export const definePage = <const Path extends string>(
  def: PageDef<PageParams<Path>> & { path: Path },
): PageDef<PageParams<Path>> & { path: Path } => Object.freeze(def);
