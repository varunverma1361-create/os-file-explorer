import { spawn } from "node:child_process";
import electron from "electron";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const child = spawn(electron, [".", "--smoke"], { env, stdio: "inherit" });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  child.kill();
  console.error("Smoke test timed out");
  process.exitCode = 1;
}, 60000);
child.on("exit", (code) => {
  clearTimeout(timer);
  process.exitCode = timedOut ? 1 : (code ?? 1);
});
child.on("error", (error) => {
  clearTimeout(timer);
  console.error(error);
  process.exitCode = 1;
});
