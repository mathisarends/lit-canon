# OpenAPI requirements

Use these rules when preparing the input specification or investigating a generation
error. The [catalog specification](../examples/catalog/openapi.json) is a minimal reference.

## The contract

Each included operation must have exactly one tag, or none when `tags.fallback` is
set (see below). The tag is the resource name: `user-settings` becomes the
`userSettings` namespace, whose keys start with `"user-settings"`. Other spellings are converted
to that form: `User Settings`, `UserSettings` and `user_settings` all become
`user-settings`, and accents are dropped (`Über` becomes `uber`). Two tags that
convert to the same resource fail. `tags.exclude` accepts the original or the
converted name.

Operations without a tag fail unless the config sets `tags.fallback`, for example
`tags: { fallback: "general" }`. These operations then form that resource. It must not
convert to the same name as a tagged resource. Each operation also needs
a unique, explicit `operationId` in `snake_case` or `camelCase`. Local parameter
references are supported. Bundle path-item references before generation.

The transformation targets JSON and multipart fetch requests (including optional
scalar multipart fields), scalar path parameters
with `simple` serialization, query parameters with `form`/`explode: true`
serialization and header parameters with `simple` serialization. Path identifiers
such as `item_id`, `scope.id` and `class` use Orval's TypeScript naming rules.
Cookie parameters, object parameters and other serialization styles are rejected
rather than silently producing a different request.

Path and query parameters become fields of the operation's input object. Path
parameters use Orval's camelCase name (`item_id` becomes `itemId`); query parameters
keep their name. A parameter that collides with another field, with `body` or with
`headers` fails.

Header parameters, such as `X-Tenant-Id` or `If-Match`, become a typed `headers`
field of the input, for example
`updateItem({ itemId, body, headers: { "If-Match": etag } })`. Headers passed in the
call-site options win over it, and it wins over `configureApiFetch` headers. Like
the rest of the input, it is part of the query key. `Accept`, `Content-Type` and `Authorization`
header parameters are ignored by OpenAPI and fail; send authentication through
[`configureApiFetch`](runtime.md#dynamic-headers).

Generated export names must not collide. An operation named `all` conflicts with
`keys.all`, and a model or operation named like a generated export, such as `keys`,
`getItemQuery` or `GetItemInput`, conflicts with it. Both fail before the existing
client is replaced.

Generated TypeScript types describe the API contract; the runtime does not validate
response bodies against the schema.

## Common generation errors

| Error / symptom                                | What to check                                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| An operation needs exactly one tag             | Give each operation one resource tag, including excluded operations, or set `tags.fallback` for untagged ones.         |
| A tag cannot be used as a directory            | Use a tag that starts with a Latin letter after conversion, such as `User Settings`.                                   |
| Two tags map to the same resource              | Use one spelling per resource, for example only `Users` or only `users`.                                               |
| Duplicate operation name or export             | Check for IDs that normalize to the same name, such as `get_product` and `getProduct`, and clashes with key factories. |
| `Operation "all" conflicts with keys.all`      | Rename the operation.                                                                                                  |
| Unsupported parameter or serialization         | Check parameter location, scalar/array shape, style and explode settings.                                              |
| Path item references must be bundled           | Resolve path-item references into the input before generation.                                                         |
| Inline problem schema is unsupported           | Move the schema to `components.schemas` and use a local reference, or set `problems: false`.                           |
| `operations.x names no included operation`     | Use the generated camelCase function name of an included operation.                                                    |
| Parameter conflicts with another input field   | Rename the parameter, for example a query parameter called `body` or two parameters with one camelCase name.           |
| `"excludeTags" was replaced by "tags.exclude"` | Rename the option; see the [migration guide](migration.md).                                                            |

The generator reports unsupported cases before replacing the existing client.
Output ownership and drift errors are explained in
[configuration](configuration.md#run-the-generator).

[All documentation](README.md)
