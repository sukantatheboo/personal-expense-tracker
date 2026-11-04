import { defineConfig } from "vite";

export default defineConfig({
  base: "/personal-expense-tracker/",
  plugins: [
    {
      name: "serve-root-manifest",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === "/manifest.webmanifest") {
            req.url = "/personal-expense-tracker/manifest.webmanifest";
          }
          next();
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@supabase")) {
            return "supabase";
          }
          if (id.includes("@capacitor")) {
            return "capacitor";
          }
          if (id.includes("react-icons")) {
            return "icons";
          }
        },
      },
    },
  },
});
