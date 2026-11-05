import { defineConfig } from "lit-canon-api";

// Copy to your application as lit-canon-api.config.ts and adapt to your API.
// Authentication headers belong in configureApiFetch from lit-canon-fetch, not here.
export default defineConfig({
  input: "./openapi.json",
  output: "./src/api/generated",
  tags: {
    // Leave out operations the app never calls, such as health checks.
    exclude: ["system"],
    // Operations without an OpenAPI tag form the "general" resource.
    fallback: "general",
  },
  operations: {
    // GET operations that change state and must not be cached or refetched.
    startLogin: "mutation",
    completeLogin: "mutation",
    // A POST that only reads data, so it can be cached like a GET.
    searchProducts: "query",
  },
  // Emit problem types for every resource, even those without problem responses.
  problems: true,
  // A sibling generator owns src/api/generated/rpc; keep it during regeneration.
  preserve: ["rpc"],
});
