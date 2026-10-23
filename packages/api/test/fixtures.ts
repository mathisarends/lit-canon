import type { OpenAPIV3 } from "@scalar/openapi-types";

export function openapi(): OpenAPIV3.Document & { paths: OpenAPIV3.PathsObject } {
  const response = (
    schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  ): OpenAPIV3.ResponsesObject => ({
    200: { description: "Success", content: { "application/json": { schema } } },
  });
  const item = { $ref: "#/components/schemas/Item" };
  const itemId: OpenAPIV3.ParameterObject = {
    name: "itemId",
    in: "path",
    required: true,
    schema: { type: "string" },
  };
  return {
    openapi: "3.0.3",
    info: { title: "Reusable API", version: "1.0.0" },
    paths: {
      "/items": {
        get: {
          tags: ["items"],
          operationId: "list_items",
          parameters: [{ $ref: "#/components/parameters/Limit" }],
          responses: response({ type: "array", items: item }),
        },
        post: {
          tags: ["items"],
          operationId: "create_item",
          requestBody: { required: true, content: { "application/json": { schema: item } } },
          responses: response(item),
        },
      },
      "/items/{itemId}": {
        parameters: [itemId],
        get: { tags: ["items"], operationId: "get_item", responses: response(item) },
        delete: {
          tags: ["items"],
          operationId: "delete_item",
          parameters: [{ name: "force", in: "query", schema: { type: "boolean" } }],
          responses: { 204: { description: "Deleted" } },
        },
      },
      "/upload": {
        post: {
          tags: ["files"],
          operationId: "upload_file",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: { file: { type: "string", format: "binary" } },
                },
              },
            },
          },
          responses: response(item),
        },
      },
      "/oauth": {
        get: {
          tags: ["auth"],
          operationId: "start_login",
          responses: response({ type: "string" }),
        },
      },
      "/admin": {
        get: { tags: ["admin"], operationId: "list_admin", responses: response(item) },
      },
      "/ping": {
        get: { tags: ["system"], operationId: "ping", responses: { 204: { description: "OK" } } },
      },
    },
    components: {
      parameters: { Limit: { name: "limit", in: "query", schema: { type: "integer" } } },
      schemas: {
        Item: {
          type: "object",
          required: ["id", "name"],
          properties: { id: { type: "string" }, name: { type: "string" } },
        },
      },
    },
  };
}
