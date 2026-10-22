import HudPopover from "../../HudPopover";
import { stories } from "./definitions";
import { openingStoryID, type StoryID } from "./progress";

export default function StoryMenu({
  onOpen,
  unlocked = [openingStoryID],
}: {
  onOpen: (id: StoryID) => void;
  unlocked?: readonly StoryID[];
}) {
  return (
    <HudPopover className="controls-guide story-menu" label="重放剧情">
      <div className="controls-guide-content">
        <h3>剧情列表</h3>
        <ul>
          {stories.filter((story) => unlocked.includes(story.id)).map((story) => (
            <li key={story.id}>
              <button
                type="button"
                onClick={(event) => {
                  const details = event.currentTarget.closest("details");
                  if (details) {
                    details.open = false;
                    details.querySelector("summary")?.focus();
                  }
                  onOpen(story.id);
                }}
              >
                {story.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </HudPopover>
  );
}
