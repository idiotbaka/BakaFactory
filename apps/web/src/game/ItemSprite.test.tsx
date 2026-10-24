import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Catalog } from "../api/client";
import definitions from "../../../server/internal/catalog/definitions.json";
import DefinitionIcon from "./DefinitionIcon";
import { itemSpriteColor, itemSpriteURL } from "./itemSprites";
import { buildingSpriteURL } from "./buildingArtwork";

afterEach(cleanup);
const catalog = definitions as unknown as Catalog;

it("renders separate cached rasters for GUI items and front-facing buildings", () => {
  const item = catalog.items.find((d) => d.id === "i0001")!;
  const building = catalog.buildings.find((d) => d.id === "bus")!;
  const { container, rerender } = render(
    <DefinitionIcon definition={item} compact />,
  );
  const image = container.querySelector("img")!;
  expect(image.getAttribute("src")).toBe(itemSpriteURL(item.id));
  expect(image.getAttribute("width")).toBe("128");
  expect(image.getAttribute("draggable")).toBe("false");
  expect(container.querySelector("svg")).toBeNull();
  expect(container.querySelector(".item-sprite")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  rerender(<DefinitionIcon definition={building} rotation={90} compact />);
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    buildingSpriteURL(building.id),
  );
  expect(container.querySelector("img")?.style.transform).toBe("");
  expect(container.querySelector("svg")).toBeNull();
});

it("uses actual item stage for floor color, including the early P2 pipe", () => {
  // This item is unlocked in P2 while its original catalog color is P3 mint.
  expect(itemSpriteColor("i0170")).toBe("#a5d4b2");
  expect(itemSpriteColor("i0341")).toBe("#ff72cf");
  expect(itemSpriteColor("iron_ore")).toBe("#ffc879");
});

it("keeps an SVG fallback for definitions with no raster asset", () => {
  const item = { ...catalog.items[0], id: "future_unknown_item" };
  expect(itemSpriteURL(item.id)).toBeUndefined();
  const { container } = render(<DefinitionIcon definition={item} />);
  expect(container.querySelector("svg")).not.toBeNull();
  expect(container.querySelector("img")).toBeNull();
});
