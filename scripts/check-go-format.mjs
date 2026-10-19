import { execFileSync } from "node:child_process";
import { serverRoot } from "./process.mjs";
const files = execFileSync("gofmt", ["-l", "."], {
  cwd: serverRoot,
  encoding: "utf8",
}).trim();
if (files) {
  console.error(`Run gofmt on:\n${files}`);
  process.exitCode = 1;
}
