import { AssetPreloader, type GameAsset } from "./assetPreloader";
import { itemSpriteURLs } from "./itemSprites";
import { buildingSpriteURLs } from "./buildingArtwork";

export const gameFont = {
  family: "Fusion Pixel Game",
  url: `${import.meta.env.BASE_URL}fonts/fusion-pixel/fusion-pixel-12px-proportional-zh_hans-v2026.10.16.woff2`,
};
export const gameAssets: readonly GameAsset[] = [
  { kind: "font", url: gameFont.url },
  ...[
    ...itemSpriteURLs,
    ...buildingSpriteURLs,
    `${import.meta.env.BASE_URL}favicon.svg`,
  ].map((url) => ({ kind: "image" as const, url })),
];

export function loadGameImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: unknown) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) reject(error);
      else resolve(image);
    };
    const timeout = setTimeout(() => {
      finish(new Error("图标加载超时"));
      image.src = "";
    }, 30000);
    image.onload = () => {
      if (!image.naturalWidth) {
        finish(new Error("图标无法读取"));
        return;
      }
      // A successful HTTP request alone does not mean the image can be painted.
      void (
        typeof image.decode === "function" ? image.decode() : Promise.resolve()
      ).then(
        () => finish(),
        (error: unknown) => finish(error),
      );
    };
    image.onerror = () => finish(new Error("图标加载失败"));
    image.decoding = "async";
    image.src = url;
  });
}

export function loadGameFont(): Promise<FontFace[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("字体加载超时")), 30000);
    void (async () => {
      if (!document.fonts || typeof FontFace !== "function")
        throw new Error("浏览器不支持字体预热");
      const existing: FontFace[] = [];
      document.fonts.forEach((face) => {
        if (
          face.family.replace(/^["']|["']$/g, "") === gameFont.family &&
          face.status === "loaded"
        )
          existing.push(face);
      });
      if (existing.length) return existing;
      // A failed FontFace retains its rejected load promise. Create a fresh
      // face for an actual retry, while sharing the same versioned HTTP URL.
      const face = new FontFace(
        gameFont.family,
        `url("${gameFont.url}") format("woff2")`,
        { weight: "400", style: "normal", display: "swap" },
      );
      await face.load();
      if (face.status !== "loaded") throw new Error("游戏字体未能加载");
      document.fonts.add(face);
      return [face];
    })()
      .then(resolve, reject)
      .finally(() => clearTimeout(timeout));
  });
}

// Static resources are shared across StrictMode, owner changes and retries.
// The simulation is started by useLocalGame only after this queue succeeds.
export const gameAssetPreloader = new AssetPreloader(gameAssets, (asset) =>
  asset.kind === "font" ? loadGameFont() : loadGameImage(asset.url),
);
