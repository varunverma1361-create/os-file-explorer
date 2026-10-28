import { spawn } from "node:child_process";
import { createServer } from "vite";
import { build } from "esbuild";
import electron from "electron";
await build({
  entryPoints: ["electron/main.ts", "electron/preload.ts"],
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
const server = await createServer();
await server.listen();
const env = { ...process.env, ELECTRON_RENDERER_URL: "http://127.0.0.1:5173" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [".", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on("SIGINT", () => child.kill());
child.on("error", async (error) => {
  console.error(error);
  await server.close();
  process.exit(1);
});
