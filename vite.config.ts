import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";

export default defineConfig({
  root: "src/ui",
  plugins: [viteSingleFile()],
  build: {
    outDir: path.resolve("dist/ui"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve("src/ui/image-viewer.html"),
    },
  },
});
