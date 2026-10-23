# OpenAPI requirements

Use these rules when preparing the input specification or investigating a generation
error. The [catalog specification](../examples/catalog/openapi.json) is a minimal reference.

## OpenAPI requirements

Each included operation must have exactly one tag in the format
`lower-case-with-hyphens` and a unique, explicit `operationId` in `snake_case` or
`camelCase`. Local parameter references are supported. Bundle path-item references
before generation.

The transformation targets JSON and multipart fetch requests, scalar path parameters
with `simple` serialization and query parameters with `form`/`explode: true`
serialization. Path identifiers such as `item_id`, `scope.id` and `class` use
Orval's TypeScript naming rules. Header and cookie parameters, object parameters
and other serialization styles are rejected rather than silently producing a
different request. Authentication headers can be supplied through feature
`requestOptions`.

Query factories always forward TanStack's `AbortSignal`, including when feature
request options contain their own signal. Generated export and alias collisions
fail before the existing client is replaced; alias members `allKey` and `__proto__`
are reserved.

Generated TypeScript types describe the API contract; the runtime does not validate
response bodies against the schema.

## Common generation errors

| Error / symptom                                          | What to check                                                                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| An operation needs exactly one tag                       | Give each operation one feature tag, including excluded operations.                                                        |
| A tag cannot be used as a directory                      | Use a lower-case tag starting with a letter, such as `user-settings`.                                                      |
| Duplicate operation name or export                       | Check for IDs that normalize to the same name, such as `get_product` and `getProduct`, and clashes with models or aliases. |
| Unsupported parameter or serialization                   | Check parameter location, scalar/array shape, style and explode settings.                                                  |
| Path item references must be bundled                     | Resolve path-item references into the input before generation.                                                             |
| Inline problem schema is unsupported                     | Move the schema to `components.schemas` and use a local reference, or set `problems: false`.                               |
| A configured feature, mutation or alias has no operation | Match the configuration to the included tags and operation IDs.                                                            |

The generator reports unsupported cases before replacing the existing client.
Output ownership and drift errors are explained in
[configuration](configuration.md#run-the-generator).

[All documentation](README.md)
