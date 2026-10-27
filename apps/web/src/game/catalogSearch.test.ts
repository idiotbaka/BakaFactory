import { describe, expect, it } from "vitest";
import { createCatalogSearch } from "./catalogSearch";
import generatedIndex from "./catalogSearchIndex.json";
import { catalog } from "./local/catalog";

const copper = { name: "废铜线", id: "i0004", code: "I0004" };

describe("catalog search", () => {
  it.each([
    "废铜线",
    "铜线",
    "feitongxian",
    "ftx",
    "ft",
    "tx",
    "feit",
    "tongx",
    "ongxia",
    " FEITONGXIAN ",
    "fei tong xian",
    "fei'tong'xian",
    "fèi tóng xiàn",
    "ＦＴＸ",
    "i0004",
    "I0004",
    "0004",
    "",
    "   ",
  ])("matches Chinese, codes or a partial pinyin query: %j", (query) => {
    expect(createCatalogSearch(query)(copper)).toBe(true);
  });

  it.each(["铁板", "fxz", "feixiantong", "i9999", "copper", "["])(
    "does not treat unrelated text or a regular expression as a match: %j",
    (query) => expect(createCatalogSearch(query)(copper)).toBe(false),
  );

  it("uses word context for polyphonic names and keeps English and digits", () => {
    expect(createCatalogSearch("chuansong")({ name: "初阶传送带" })).toBe(true);
    expect(createCatalogSearch("ftbyc")({ name: "发条搬运车" })).toBe(true);
    expect(
      createCatalogSearch("zz")({ name: "未知目录名称", code: "ZZ-12" }),
    ).toBe(true);
    expect(createCatalogSearch("未知目录")({ name: "未知目录名称" })).toBe(
      true,
    );
  });

  it.each(["feilvp", "feilüp", "fèi lǚ piàn", "fei lu: pian"])(
    "normalizes ü and v: %j",
    (query) =>
      expect(createCatalogSearch(query)({ name: "废铝片" })).toBe(true),
  );

  it("covers every current catalog name, so additions require fresh generated data", () => {
    const index: Record<string, string[]> = generatedIndex;
    for (const entry of [
      ...catalog.items,
      ...catalog.buildings,
      ...catalog.recipes,
      ...(catalog.robots ?? []),
    ]) {
      expect(index[entry.name], entry.name).toHaveLength(2);
      expect(
        index[entry.name].every((key) => key.length > 0),
        entry.name,
      ).toBe(true);
    }
  });
});
