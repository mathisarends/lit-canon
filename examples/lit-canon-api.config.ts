import { defineConfig } from "lit-canon-api";

export default defineConfig({
  input: "./openapi.json",
  output: "./src/api/generated",
});
