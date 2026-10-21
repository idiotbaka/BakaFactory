import HudPopover from "../../HudPopover";
import { stories } from "./definitions";
import type { StoryID } from "./progress";

export default function StoryMenu({
  onOpen,
}: {
  onOpen: (id: StoryID) => void;
}) {
  return (
    <HudPopover className="controls-guide story-menu" label="重放剧情">
      <div className="controls-guide-content">
        <h3>剧情列表</h3>
        <ul>
          {stories.map((story) => (
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
