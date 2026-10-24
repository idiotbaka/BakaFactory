import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../apps/web/src/", import.meta.url));
async function uiFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory()
          ? uiFiles(target)
          : /\.(?:css|tsx)$/.test(entry.name) && !entry.name.includes(".test.")
            ? [target]
            : [];
      }),
    )
  ).flat();
}
const sources = await Promise.all(
  (await uiFiles(root)).map(async (file) => ({
    file,
    source: (await readFile(file, "utf8")).replace(
      /\/\*[\s\S]*?\*\//g,
      (comment) => comment.replace(/[^\n]/g, " "),
    ),
  })),
);
const variables = new Map();
for (const { source } of sources) {
  for (const match of source.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g))
    variables.set(match[1], match[2].trim());
}
function minimum(value, seen = new Set()) {
  const variable = /^var\((--[\w-]+)\)$/.exec(value);
  if (variable) {
    if (seen.has(variable[1])) return NaN;
    seen.add(variable[1]);
    return minimum(variables.get(variable[1]) ?? "", seen);
  }
  // Relative / responsive sizes must explicitly clamp their lower bound.
  const bounded = /^(?:max|clamp)\(\s*(var\(--[\w-]+\)|[\d.]+px)\s*,/.exec(
    value,
  );
  if (bounded) return minimum(bounded[1], seen);
  return /^[\d.]+px$/.test(value) ? Number.parseFloat(value) : NaN;
}
let failures = 0;
function report(file, source, index, message) {
  const line = source.slice(0, index).split("\n").length;
  console.error(`${path.relative(process.cwd(), file)}:${line}: ${message}`);
  failures++;
}
const isHeavy = (value) =>
  /^(?:bold|bolder)$/.test(value) || Number(value) > 400;
for (const { file, source } of sources) {
  if (!file.endsWith(".css")) {
    for (const match of source.matchAll(/\bfontStyle\s*:\s*["']([^"']+)["']/g))
      if (!["normal", "inherit"].includes(match[1]))
        report(
          file,
          source,
          match.index,
          "Italic / oblique text is not allowed.",
        );
    for (const match of source.matchAll(
      /\bfontWeight\s*:\s*(?:["']([^"']+)["']|([\d.]+))/g,
    )) {
      if (!isHeavy(match[1] ?? match[2])) continue;
      const object = source.slice(
        source.lastIndexOf("{", match.index),
        source.indexOf("}", match.index),
      );
      const size = object.match(
        /\bfontSize\s*:\s*(?:["']([^"']+)["']|([\d.]+))/,
      );
      const value = size?.[1] ?? (size?.[2] ? `${size[2]}px` : "");
      if (!(minimum(value) >= 18))
        report(
          file,
          source,
          match.index,
          "Heavy text requires an explicit fontSize >= 18px in the same style; small text uses 400.",
        );
    }
    for (const match of source.matchAll(
      /\bfontSize\s*(?::\s*|=\s*\{?\s*)(?:"([^"]+)"|'([^']+)'|([\d.]+))/g,
    )) {
      const value = match[1] ?? match[2] ?? match[3];
      const size = /^[\d.]+$/.test(value) ? `${value}px` : value;
      if (minimum(size) >= 12) continue;
      const line = source.slice(0, match.index).split("\n").length;
      console.error(
        `${path.relative(process.cwd(), file)}:${line}: Inline fontSize must be >= 12px. Found ${value}`,
      );
      failures++;
    }
    continue;
  }
  for (const block of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (block[1].includes("@font-face")) continue;
    let size = NaN;
    const weights = [];
    for (const declaration of block[2].matchAll(
      /(?<![\w-])(font(?:-size|-weight|-style)?)\s*:\s*([^;{}]+)/g,
    )) {
      const property = declaration[1],
        value = declaration[2].trim();
      if (property === "font-style" && !["normal", "inherit"].includes(value))
        report(
          file,
          source,
          block.index,
          "Italic / oblique text is not allowed.",
        );
      if (property === "font-weight") weights.push(value);
      if (property === "font-size") size = minimum(value);
      if (property === "font") {
        const token = value.match(
          /(?:^|\s)([\d.]+(?:px|rem|em|%|vw|vh))(?=[/\s]|$)/,
        );
        size = minimum(token?.[1] ?? "");
        const prefix = value.slice(0, token?.index ?? 0);
        if (/\b(?:italic|oblique)\b/.test(prefix))
          report(
            file,
            source,
            block.index,
            "Italic / oblique shorthand text is not allowed.",
          );
        weights.push(...(prefix.match(/\b(?:bold|bolder|[5-9]\d\d)\b/g) ?? []));
      }
    }
    if (weights.some(isHeavy) && !(size >= 18))
      report(
        file,
        source,
        block.index,
        "Heavy text requires an explicit size >= 18px in the same rule; small text uses 400.",
      );
  }
  for (const match of source.matchAll(
    /(?<![\w-])(font-size|font)\s*:\s*([^;{}]+)/g,
  )) {
    const value = match[2].trim();
    if (value === "inherit") continue;
    const size =
      match[1] === "font"
        ? value.match(/(?:^|\s)([\d.]+(?:px|rem|em|%|vw|vh))(?=[/\s]|$)/)?.[1]
        : value;
    if (minimum(size ?? "") >= 12) continue;
    const line = source.slice(0, match.index).split("\n").length;
    console.error(
      `${path.relative(process.cwd(), file)}:${line}: All text must be >= 12px. Use px, a verified variable, or max(12px, ...). Found ${match[1]}: ${value}`,
    );
    failures++;
  }
}
if (failures) process.exitCode = 1;
else
  console.log(
    "UI typography: 12px minimum, heavy text requires >=18px, no italic / oblique styles.",
  );
