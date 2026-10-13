# lit-query-codegen

Generate a typed API client and TanStack Lit Query options from your OpenAPI specification.

Building a [Lit](https://lit.dev/) frontend for a REST API? This tool generates the
request functions, TypeScript types and query/mutation options that connect your
components to the backend. When the API changes, regenerate the client and let
TypeScript show you which calls need updating.

```ts
import { products } from "./api/generated";

// Call the API directly. The result is typed as Product[].
const catalog = await products.listProducts({ limit: 20 });

// Or use these options with TanStack Lit Query controllers.
const query = products.listProductsQuery({ limit: 20 });
const mutation = products.createProductMutation();
```

The [catalog example](examples/catalog/README.md) includes an OpenAPI specification,
[generated client](examples/catalog/generated/products/) and a
[Lit component](examples/catalog/catalog-element.ts) using it.

## What you get

For each API feature, the generator writes:

- **Models** for request bodies, responses and parameters.
- **Fetch functions** with encoded paths, query parameters and request bodies.
- **Query options** for GET operations, including cache keys and cancellation.
- **Mutation options** for writes, with typed variables.
- **A drift check** to verify that committed clients match the API specification.

OpenAPI tags become feature directories; `list_products` becomes `listProducts`.
You write the components, loading and error states, and cache invalidation. Generated
types describe the contract; response bodies are not validated at runtime.

## Try the checked-in example

From this repository, with **Node.js 22.18.0 or later**:

```bash
npm ci
npm run example:generate
npm run example:check
npm run typecheck
```

You can generate and inspect the client without a backend. To run the component,
you need a Lit application and an API implementing the example's contract.

## Installation

The generator requires Node.js 22.18.0 or later and a local OpenAPI 3 JSON file.
Generated clients target a TypeScript frontend with bundler module resolution.

Build a local package from this checkout, then install it in your application:

```bash
# In this repository
npm ci
npm pack

# In your application; adjust the path to the tarball
npm install /path/to/lit-query-codegen-0.1.0.tgz
npm install @tanstack/lit-query@0.2.25 @tanstack/query-core@5.104.0 lit
```

The default client imports `lit-query-codegen/runtime`, so keep this package as an
application dependency. If you provide your own fetch mutator, you can install it
with `--save-dev`. See [getting started](docs/getting-started.md#installation) for
more setup details.

## Generate your client

Create `lit-query-codegen.config.ts` in your application:

```ts
import { defineConfig } from "lit-query-codegen";

export default defineConfig({
  input: "./openapi.json",
  output: "./src/api/generated",
});
```

Paths are relative to the config file. Use a dedicated output directory and keep
handwritten code outside it. Included operations need one tag such as `products`
and a unique `operationId`, such as `list_products`.

```bash
npx lit-query-codegen
npx lit-query-codegen --check
```

Generation replaces the generated client after all generation steps succeed.
`--check` reports missing, changed or obsolete files without replacing the client,
and exits with code 1 when it finds a difference.

By default, requests use relative paths and include cookies. If your API lives
elsewhere, configure the runtime when your application starts:

```ts
import { configureApiFetch } from "lit-query-codegen/runtime";

configureApiFetch({ baseUrl: "https://api.example.com" });
```

Next, [use the generated options in a Lit component](docs/getting-started.md#use-it-in-a-lit-component).

## Documentation

| Task                                                    | Read                                           |
| ------------------------------------------------------- | ---------------------------------------------- |
| Install, generate and use a client                      | [Getting started](docs/getting-started.md)     |
| Configure auth, aliases, problem types or shared output | [Configuration and CLI](docs/configuration.md) |
| Set up requests and handle API errors                   | [Fetch runtime](docs/runtime.md)               |
| Check whether your specification is supported           | [OpenAPI requirements](docs/openapi.md)        |
| Work on the generator                                   | [Development](docs/development.md)             |
| Find the implementation of a behavior                   | [Architecture](docs/architecture.md)           |
| Make changes as a coding agent                          | [Agent guide](docs/agents.md)                  |

The [documentation index](docs/README.md) gives a reading path for application
developers, contributors and agents.

## Development

```bash
npm ci
npm test
npm run typecheck
npm run example:check
npm run format:check
```

See [development](docs/development.md) for package checks and client parity tools.
The package currently uses `UNLICENSED`; choose a public license before publishing
if needed.
