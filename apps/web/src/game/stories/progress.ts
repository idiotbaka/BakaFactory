export const storyIDs = [
  "opening_clock_out",
  "p1_factory_feast",
  "p2_crowded_hatch",
  "p2_shaft_overload",
] as const;
export type StoryID = (typeof storyIDs)[number];
export const openingStoryID = "opening_clock_out" satisfies StoryID;
export const p1StoryID = "p1_factory_feast" satisfies StoryID;
export const p2HatchStoryID = "p2_crowded_hatch" satisfies StoryID;
export const p2ShaftStoryID = "p2_shaft_overload" satisfies StoryID;
const questRequirements: Partial<Record<StoryID, string>> = {
  [p1StoryID]: "p1_free_hands",
  [p2HatchStoryID]: "p2_crowded_hatch",
  [p2ShaftStoryID]: "p2_shaft_work",
};

export function unlockedStoryIDs(claimed: readonly string[] = []) {
  return storyIDs.filter(
    (id) => !questRequirements[id] || claimed.includes(questRequirements[id]!),
  );
}

// Only a newly confirmed claim triggers an automatic chapter. Old saves and
// cloud restore establish a baseline instead of inventing a new reward event.
export function newlyClaimedStories(
  previous: readonly string[],
  next: readonly string[],
  viewed: readonly string[] = [],
) {
  return storyIDs.filter((id) => {
    const quest = questRequirements[id];
    return (
      !!quest &&
      !previous.includes(quest) &&
      next.includes(quest) &&
      !viewed.includes(id)
    );
  });
}

export function retainPendingStories(
  pending: readonly string[] = [],
  viewed: readonly string[] = [],
  claimed: readonly string[] = [],
) {
  return pending.filter((id) => {
    const known = storyIDs.find((knownID) => knownID === id);
    const quest = known && questRequirements[known];
    return !viewed.includes(id) && (!quest || claimed.includes(quest));
  });
}

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
