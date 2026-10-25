import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

// 课程前端开发端口 5210；构建结果由后端 8210 端口托管。
const apiProxy = {
  "/api": {
    target: process.env.API_TARGET ?? "http://127.0.0.1:8210",
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5210,
    strictPort: true,
    host: "127.0.0.1",
    proxy: apiProxy,
    fs: { allow: [".."] },
  },
  preview: {
    port: Number(process.env.WEB_PORT ?? 5175),
    host: "127.0.0.1",
    proxy: apiProxy,
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/element-plus")) return "element-plus";
          return undefined;
        },
      },
    },
  },
});
