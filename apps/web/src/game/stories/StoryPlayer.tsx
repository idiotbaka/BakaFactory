import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Story, StoryPage } from "./definitions";
import "./stories.css";

const TYPE_DURATION = 3000;
export function StoryText({
  paragraphs,
  powerSaving,
  id,
}: {
  paragraphs: string[];
  powerSaving: boolean;
  id: string;
}) {
  const text = paragraphs.join("\n");
  const characters = Array.from(text);
  const [startedAt] = useState(() => performance.now());
  const [visible, setVisible] = useState(0);
  const complete = visible >= characters.length;
  useEffect(() => {
    if (complete) return;
    const count = Array.from(text).length;
    const advance = () => {
      const fraction = Math.min(
        1,
        Math.max(0, (performance.now() - startedAt) / TYPE_DURATION),
      );
      setVisible(Math.ceil(count * fraction));
      if (fraction >= 1) clearInterval(interval);
    };
    const interval = setInterval(advance, 1000 / (powerSaving ? 15 : 30));
    const finish = setTimeout(
      () => {
        clearInterval(interval);
        setVisible(count);
      },
      Math.max(0, TYPE_DURATION - (performance.now() - startedAt)),
    );
    return () => {
      clearInterval(interval);
      clearTimeout(finish);
    };
  }, [text, startedAt, complete, powerSaving]);
  return (
    <div className="story-text-area">
      <p className="sr-only" id={id}>
        {text}
      </p>
      <div className="story-copy" aria-hidden="true">
        <span className="story-copy-reserve">{text}</span>
        <span className="story-copy-visible" data-testid="story-typewriter">
          {characters.slice(0, visible).join("")}
        </span>
      </div>
    </div>
  );
}

function StorySlide({
  page,
  powerSaving,
  textID,
}: {
  page: StoryPage;
  powerSaving: boolean;
  textID: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <img
        className="story-illustration"
        src={page.image}
        alt={page.alt}
        width={1672}
        height={941}
        decoding="async"
        onError={() => setFailed(true)}
      />
      {failed && (
        <p className="story-image-error" role="status">
          图片暂时无法加载，仍可阅读下方剧情并翻页。
        </p>
      )}
      <StoryText
        paragraphs={page.paragraphs}
        powerSaving={powerSaving}
        id={textID}
      />
    </>
  );
}

export default function StoryPlayer({
  story,
  powerSaving,
  onComplete,
  onClose,
}: {
  story: Story;
  powerSaving: boolean;
  onComplete: () => Promise<void>;
  onClose?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const completing = useRef(false);
  const previousIndex = useRef(0);
  const titleID = useId(),
    textID = useId();
  const page = story.pages[index],
    last = index === story.pages.length - 1;
  const previous = () => {
    if (!saving) setIndex((i) => Math.max(0, i - 1));
  };
  const next = () => {
    if (!saving) setIndex((i) => Math.min(story.pages.length - 1, i + 1));
  };
  const handlers = useRef({ previous, next, onClose, saving });
  useLayoutEffect(() => {
    handlers.current = { previous, next, onClose, saving };
  });
  useLayoutEffect(() => {
    if (previousIndex.current === index) return;
    previousIndex.current = index;
    if (content.current) content.current.scrollTop = 0;
    pageHeading.current?.focus();
  }, [index]);
  useEffect(() => {
    const preview = new Image();
    const following = story.pages[index + 1];
    if (following) preview.src = following.image;
  }, [story, index]);
  useLayoutEffect(() => {
    const panel = dialog.current;
    const origin = document.activeElement;
    const background =
      document.querySelector<HTMLElement>(".factory-workspace");
    const wasInert = background?.inert ?? false;
    const overflow = document.body.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = "hidden";
    pageHeading.current?.focus();
    const targets = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),[tabindex="0"]',
        ) ?? [],
      );
    const key = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.key === "Tab") {
        event.preventDefault();
        const focusable = targets();
        const current = focusable.indexOf(
          document.activeElement as HTMLElement,
        );
        const nextIndex =
          current < 0
            ? event.shiftKey
              ? focusable.length - 1
              : 0
            : (current + (event.shiftKey ? -1 : 1) + focusable.length) %
              focusable.length;
        focusable[nextIndex]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (!handlers.current.saving) handlers.current.onClose?.();
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (["ArrowUp", "ArrowLeft", "PageUp"].includes(event.key)) {
          event.preventDefault();
          if (!event.repeat) handlers.current.previous();
        } else if (
          ["ArrowDown", "ArrowRight", "PageDown"].includes(event.key)
        ) {
          event.preventDefault();
          if (!event.repeat) handlers.current.next();
        } else if (
          /^[1-6fr]$/i.test(event.key) ||
          ["Delete", "Backspace"].includes(event.key)
        )
          event.preventDefault();
      }
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel?.contains(event.target))
        pageHeading.current?.focus();
    };
    window.addEventListener("keydown", key, true);
    document.addEventListener("focusin", focus);
    return () => {
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("focusin", focus);
      if (background) background.inert = wasInert;
      document.body.style.overflow = overflow;
      if (
        origin instanceof HTMLElement &&
        origin !== document.body &&
        origin.isConnected
      )
        origin.focus();
      else
        background?.querySelector<HTMLInputElement>("#factory-name")?.focus();
    };
  }, []);
  async function finish() {
    if (!last || completing.current) return;
    completing.current = true;
    setSaving(true);
    setError("");
    try {
      await onComplete();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "无法保存观看记录，请重试。",
      );
    } finally {
      completing.current = false;
      setSaving(false);
    }
  }
  return createPortal(
    <div
      className="story-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose?.();
      }}
    >
      <div
        className="story-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleID}
      >
        <header className="story-header">
          <div>
            <h2 id={titleID}>{story.title}</h2>
            <h3 ref={pageHeading} tabIndex={-1} aria-describedby={textID}>
              {index + 1} / {story.pages.length} · {page.title}
            </h3>
          </div>
          {onClose && (
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              aria-label="关闭剧情"
            >
              关闭 ×
            </button>
          )}
        </header>
        <div
          className="story-content"
          ref={content}
          tabIndex={0}
          aria-label="剧情内容滚动区域"
        >
          <StorySlide
            key={index}
            page={page}
            powerSaving={powerSaving}
            textID={textID}
          />
        </div>
        {error && (
          <p className="story-error" role="alert">
            {error}
          </p>
        )}
        <footer className="story-footer">
          <button
            type="button"
            disabled={index === 0 || saving}
            onClick={previous}
          >
            上一页
          </button>
          <span>
            第 {index + 1} / {story.pages.length} 页
          </span>
          <button
            type="button"
            disabled={saving}
            onClick={last ? () => void finish() : next}
          >
            {saving ? "正在保存…" : last ? "完成" : "下一页"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
