import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("../", import.meta.url));
export const serverRoot = fileURLToPath(
  new URL("../apps/server/", import.meta.url),
);
export const binary = fileURLToPath(
  new URL(
    `../dist/bakafactory${process.platform === "win32" ? ".exe" : ""}`,
    import.meta.url,
  ),
);
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code ?? signal}`)),
    );
  });
}
