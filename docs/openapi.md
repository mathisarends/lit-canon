# OpenAPI requirements

Use these rules when preparing the input specification or investigating a generation
error. The [catalog specification](../examples/catalog/openapi.json) is a minimal reference.

## The contract

Each included operation must have exactly one tag, or none when `defaultTag` is set
(see below). The tag is the resource name:
`user-settings` becomes the `userSettings` namespace with a `userSettingsKeys`
factory and query keys starting with `"user-settings"`. Other spellings are converted
to that form: `User Settings`, `UserSettings` and `user_settings` all become
`user-settings`, and accents are dropped (`Über` becomes `uber`). Two tags that
convert to the same resource fail. `excludeTags` accepts the original or the
converted name.

Operations without a tag fail unless the config sets `defaultTag`, for example
`defaultTag: "general"`. These operations then form that resource. It must not
convert to the same name as a tagged resource. Each operation also needs
a unique, explicit `operationId` in `snake_case` or `camelCase`. Local parameter
references are supported. Bundle path-item references before generation.

The transformation targets JSON and multipart fetch requests, scalar path parameters
with `simple` serialization and query parameters with `form`/`explode: true`
serialization. Path identifiers such as `item_id`, `scope.id` and `class` use
Orval's TypeScript naming rules. Header and cookie parameters, object parameters
and other serialization styles are rejected rather than silently producing a
different request. Send headers such as authentication through
[`configureApiFetch`](runtime.md#dynamic-headers) instead.

Generated export names must not collide. A query operation named `all` conflicts
with `<resource>Keys.all`, and a model or operation named like a generated factory,
such as `itemsKeys`, conflicts with it. Both fail before the existing client is
replaced.

Generated TypeScript types describe the API contract; the runtime does not validate
response bodies against the schema.

## Common generation errors

| Error / symptom                                  | What to check                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| An operation needs exactly one tag               | Give each operation one resource tag, including excluded operations, or set `defaultTag` for untagged ones.            |
| A tag cannot be used as a directory              | Use a tag that starts with a Latin letter after conversion, such as `User Settings`.                                   |
| Two tags map to the same resource                | Use one spelling per resource, for example only `Users` or only `users`.                                               |
| Duplicate operation name or export               | Check for IDs that normalize to the same name, such as `get_product` and `getProduct`, and clashes with key factories. |
| `Query operation "all" conflicts with …Keys.all` | Rename the operation, or mark it with `mutationOperations` if it is not a query.                                       |
| Unsupported parameter or serialization           | Check parameter location, scalar/array shape, style and explode settings.                                              |
| Path item references must be bundled             | Resolve path-item references into the input before generation.                                                         |
| Inline problem schema is unsupported             | Move the schema to `components.schemas` and use a local reference, or set `problems: false`.                           |
| Configured mutation has no included operation    | Match `mutationOperations` to the included tags and operation IDs.                                                     |
| `"features" was removed in lit-canon-api 1.0`    | Remove the option; see the [migration guide](migration.md#removed-options).                                            |

The generator reports unsupported cases before replacing the existing client.
Output ownership and drift errors are explained in
[configuration](configuration.md#run-the-generator).

[All documentation](README.md)
