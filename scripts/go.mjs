import { run, serverRoot } from "./process.mjs";
await run("go", process.argv.slice(2), { cwd: serverRoot });
