import { afterEach, expect, it, vi } from "vitest";
import { gameAssets, loadGameFont, loadGameImage } from "./gameAssets";
import { itemSpriteURLs } from "./itemSprites";
import { buildingSpriteURLs } from "./buildingArtwork";
import { robotSpriteURLs } from "./robotSprites";

const fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (fontsDescriptor)
    Object.defineProperty(document, "fonts", fontsDescriptor);
  else Reflect.deleteProperty(document, "fonts");
});

it("warms every item / building raster and the bundled font", () => {
  const urls = new Set(gameAssets.map((asset) => asset.url));
  for (const url of [
    ...itemSpriteURLs,
    ...buildingSpriteURLs,
    ...robotSpriteURLs,
  ])
    expect(urls.has(url)).toBe(true);
  expect(gameAssets.filter((asset) => asset.kind === "font")).toHaveLength(1);
});

it("does not finish an image until decoding succeeds", async () => {
  vi.useFakeTimers();
  let decode!: () => void;
  const decoded = new Promise<void>((resolve) => {
    decode = resolve;
  });
  const instance = {
    src: "",
    decoding: "",
    naturalWidth: 128,
    onload: null as null | (() => void),
    onerror: null as null | (() => void),
    decode: vi.fn(() => decoded),
  };
  vi.stubGlobal(
    "Image",
    class {
      constructor() {
        return instance;
      }
    },
  );
  let finished = false;
  const task = loadGameImage("/icon.png").then((value) => {
    finished = true;
    return value;
  });
  instance.onload!();
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(instance.decode).toHaveBeenCalledOnce();
  decode();
  expect(await task).toBe(instance);
  expect(finished).toBe(true);
  expect(instance.onload).toBeNull();
});

it("rejects a stalled image so retry can remain on the loading screen", async () => {
  vi.useFakeTimers();
  const instance = { src: "", onload: null, onerror: null };
  vi.stubGlobal(
    "Image",
    class {
      constructor() {
        return instance;
      }
    },
  );
  const task = loadGameImage("/stalled.png");
  const rejection = expect(task).rejects.toThrow("图标加载超时");
  await vi.advanceTimersByTimeAsync(30000);
  await rejection;
  expect(instance.src).toBe("");
});

it("retries a failed font with a fresh face, then reuses the registered face", async () => {
  const registered = new Set<FontFace>();
  let attempts = 0;
  const created = vi.fn();
  vi.stubGlobal(
    "FontFace",
    class {
      family = "Fusion Pixel Game";
      status = "unloaded";
      load = vi.fn(async () => {
        if (attempts === 1) {
          this.status = "error";
          throw new Error("font network failure");
        }
        this.status = "loaded";
        return this;
      });
      constructor(...args: unknown[]) {
        attempts++;
        created(...args);
      }
    },
  );
  const add = vi.fn((face: FontFace) => registered.add(face));
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      forEach: (visit: (face: FontFace) => void) => registered.forEach(visit),
      add,
    },
  });
  await expect(loadGameFont()).rejects.toThrow("font network failure");
  expect(add).not.toHaveBeenCalled();
  const faces = await loadGameFont();
  expect(faces[0].status).toBe("loaded");
  expect(add).toHaveBeenCalledOnce();
  expect(await loadGameFont()).toEqual(faces);
  expect(attempts).toBe(2);
  expect(created.mock.calls[0][0]).toBe("Fusion Pixel Game");
  expect(created.mock.calls[0][2]).toEqual({
    weight: "400",
    style: "normal",
    display: "swap",
  });
});
