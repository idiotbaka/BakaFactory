const files = import.meta.glob<string>("../assets/robots/v1/*.png", {
  eager: true,
  query: "?url&no-inline",
  import: "default",
});
export type RobotDirection = "right" | "left" | "up" | "down";
export const robotSpriteURLs: readonly string[] = Object.values(files);
export function robotSpriteURL(item: string, direction: RobotDirection) {
  return files[
    `../assets/robots/v1/${item}-${direction === "left" || direction === "right" ? "side" : direction}.png`
  ];
}
