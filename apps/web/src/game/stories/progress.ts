export const storyIDs = ["opening_clock_out"] as const;
export type StoryID = (typeof storyIDs)[number];
export const openingStoryID: StoryID = "opening_clock_out";

// UI metadata may retain retired / future identifiers; never discard a save
// merely because its story list was authored in a different content revision.
export function validViewedStories(
  value: unknown,
): value is string[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= 1000 &&
      new Set(value).size === value.length &&
      value.every(
        (id) =>
          typeof id === "string" &&
          id.length <= 128 &&
          /^[a-z][a-z0-9_]*$/.test(id),
      ))
  );
}
