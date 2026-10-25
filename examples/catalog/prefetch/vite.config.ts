import { defineConfig } from "vite";
import type { Product } from "../generated/products/models.js";

const products: Product[] = [
  { id: "notebook", name: "Notebook", price: 12.5 },
  { id: "pencil", name: "Pencil", price: 1.8 },
  { id: "backpack", name: "Backpack", price: 49 },
];

// Development-only API matching the checked-in OpenAPI contract.
export default defineConfig({
  plugins: [
    {
      name: "catalog-demo-api",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url ?? "/", "http://localhost");
          if (!url.pathname.startsWith("/api/products")) return next();
          const product = products.find((item) => url.pathname === `/api/products/${item.id}`);
          const data = url.pathname === "/api/products" ? products : product;
          setTimeout(() => {
            response.statusCode = data ? 200 : 404;
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify(data ?? { title: "Product not found", status: 404 }));
          }, 700);
        });
      },
    },
  ],
});
