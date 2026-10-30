import { defineConfig } from "vite";

export default defineConfig({
  base: "/personal-expense-tracker/",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@supabase")) {
            return "supabase";
          }
        },
      },
    },
  },
});
