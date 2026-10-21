// Explicit user-run measurement only: no browser, service, file save or DB.
const options = {
  districts: 6,
  machines: 24,
  robots: 12,
  ticks: 60,
  warmup: 5,
  seed: 1,
  profile: "mixed",
};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]?.replace(/^--/, "");
  if (!Object.hasOwn(options, key) || args[i + 1] === undefined)
    throw new Error(
      "参数为 --districts / --machines / --robots / --ticks / --warmup / --seed / --profile 值",
    );
  options[key] = key === "profile" ? args[i + 1] : Number(args[i + 1]);
}
const { runBenchmark } =
  await import("../dist/benchmark/simulation-benchmark.mjs");
console.log(JSON.stringify(runBenchmark(options), null, 2));
