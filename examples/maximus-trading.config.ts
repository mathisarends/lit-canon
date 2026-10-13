import { defineConfig } from "lit-query-codegen";

// Place this file in maximus-trading/frontend as lit-query-codegen.config.ts.
export default defineConfig({
  input: "../backend/openapi.json",
  output: "src/api/generated",
  request: { path: "./src/api/request.ts" },
  excludeTags: ["system"],
  preserveDirectories: ["rpc"],
  problems: true,
  mutationOperations: ["start_google_login", "complete_google_login"],
  features: {
    admin: {
      imports: [
        {
          from: "./src/api/admin-auth.ts",
          names: ["adminHeaders", "adminQueryScope", "hasAdminAccess"],
        },
      ],
      requestOptions: "{ headers: adminHeaders() }",
      queryKey: ["adminQueryScope()"],
      enabled: "hasAdminAccess()",
    },
  },
  queryAliases: {
    admin: {
      adminUsers: {
        list: "admin_list_users",
        detail: "admin_get_user",
      },
    },
  },
});
