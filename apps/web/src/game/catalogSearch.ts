import generatedIndex from "./catalogSearchIndex.json";

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/u\u0308/g, "v")
    .replace(/\p{M}/gu, "")
    .replace(/u:/g, "v")
    .replace(/[\s'’]+/g, "");
}

// Only the small generated catalog ships to the browser. The pronunciation
// dictionary is a development dependency used by generate-search-index.mjs.
const index = new Map(
  Object.entries(generatedIndex).map(([name, keys]) => [
    name,
    [normalize(name), ...keys.map(normalize)],
  ]),
);

type Searchable = { name?: string; id?: string; code?: string };

/** Case-insensitive substring matching for Chinese, codes, pinyin and initials. */
export function createCatalogSearch(query: string) {
  const needle = normalize(query);
  return ({ name = "", id = "", code = "" }: Searchable): boolean =>
    !needle ||
    (index.get(name) ?? [normalize(name)]).some((key) =>
      key.includes(needle),
    ) ||
    normalize(id).includes(needle) ||
    normalize(code).includes(needle);
}
