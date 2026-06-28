import { defineConfig } from "vite";
import { spawn } from "child_process";
import path from "path";

export default defineConfig({
  server: {
    port: 5174,
  },
  build: {
    outDir: "dist",
  },
  base: "/",
  plugins: [
    {
      name: "start-websocket-server",
      configureServer(server) {
        const serverPath = path.resolve(__dirname, "server.ts");
        const child = spawn("tsx", [serverPath], {
          stdio: "inherit",
          cwd: __dirname,
        });

        child.on("error", (err) => {
          console.error("[ws-server] 启动失败:", err);
        });

        server.httpServer?.on("close", () => {
          child.kill();
        });
      },
    },
  ],
});
