import { useEffect, useState } from "react";
import type { Catalog } from "../api/client";
import type { GameView } from "./local/runtime";

type Notice = NonNullable<GameView["questNotices"]>[number];
export default function QuestNotifications({
  notices,
  catalog,
}: {
  notices: Notice[];
  catalog: Catalog;
}) {
  const [dismissed, setDismissed] = useState(0);
  const current = notices.find((n) => n.sequence > dismissed);
  const sequence = current?.sequence;
  useEffect(() => {
    if (sequence === undefined) return;
    const timer = setTimeout(() => setDismissed(sequence), 3000);
    return () => clearTimeout(timer);
  }, [sequence]);
  const quest = catalog.quests?.find((q) => q.id === current?.id);
  return (
    <div
      className="quest-notification"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {quest && (
        <>
          任务达成：{quest.title}
          <span>前往“任务”领取奖励</span>
        </>
      )}
    </div>
  );
}
