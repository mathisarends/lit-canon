import { queryClientContext } from "@tanstack/lit-query";
import type { FetchQueryOptions } from "@tanstack/lit-query";
import type { PrefetchContext } from "./page.js";

/** Query factories keep their own inference; only execution erases the result types. */
type PrefetchQuery = FetchQueryOptions<any, any, any, any>;

/** Adapt a named set of shared query options to a page's speculative prefetch hook. */
export function prefetchQueries<P>(
  queries: (ctx: PrefetchContext<P>) => Record<string, PrefetchQuery>,
): (ctx: PrefetchContext<P>) => Promise<void> {
  return async (ctx) => {
    const client = ctx.container.get(queryClientContext);
    await Promise.all(Object.values(queries(ctx)).map((options) => client.prefetchQuery(options)));
  };
}
