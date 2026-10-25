# Documentation

Choose the path that matches what you want to do.

## Use the generated client in an application

1. [Getting started](getting-started.md): install the packages, generate a client
   and use the options in a Lit component.
2. [Configuration and CLI](configuration.md): options, the `generate` and `check`
   commands, problem types and output ownership.
3. [Fetch runtime](runtime.md): request defaults, header functions, errors and custom
   request modules.
4. [Using the client in a lit-canon app](lit-canon.md): the canonical setup with
   `lit-canon-composition`.
5. [Prefetching and page scaffolding](prefetching.md): shared query options, intent
   prefetch and the one-time `add-page` command.

See [OpenAPI requirements](openapi.md) when preparing the specification or fixing a
generation error, and [migration](migration.md) when upgrading from the 0.x
generator. The [catalog example](../examples/catalog/README.md) shows the input,
generated output and components together.

For app composition (pages, features, guards, providers), see the
[lit-canon-composition README](../packages/composition/README.md).

## Work on this repository

- [Development](development.md): workspace setup, commands and conventions.
- [Architecture](architecture.md): generation flow and source maps of the packages.
- [Agent guide](agents.md): canonical app usage, behaviors to preserve and checks.
- [Decisions](decisions/): recorded design decisions, starting with
  [0001: Orval post-processing](decisions/0001-orval-postprocessing.md).

The guides describe the current implementation. When behavior changes, update the
relevant page alongside the code and examples.

[Back to the project README](../README.md)
