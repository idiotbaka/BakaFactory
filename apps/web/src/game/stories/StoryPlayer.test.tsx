import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StoryPlayer, { StoryText } from "./StoryPlayer";
import { storyDefinitions } from "./definitions";
import { openingStoryID, validViewedStories } from "./progress";

const story = storyDefinitions[openingStoryID];
afterEach(() => vi.useRealTimers());
describe("story playback", () => {
  it.each([false, true])(
    "finishes typing within three seconds in powerSaving=%s without narration layout changes",
    (powerSaving) => {
      vi.useFakeTimers({
        toFake: [
          "setTimeout",
          "clearTimeout",
          "setInterval",
          "clearInterval",
          "performance",
        ],
      });
      const paragraphs = ["早安，09 号。", "唔，先从这十二包垃圾开始吧。"],
        text = paragraphs.join("\n");
      const { rerender, unmount } = render(
        <StoryText
          paragraphs={paragraphs}
          powerSaving={powerSaving}
          id="copy"
        />,
      );
      expect(screen.getByTestId("story-typewriter")).toBeEmptyDOMElement();
      act(() => vi.advanceTimersByTime(1500));
      const halfway =
        screen.getByTestId("story-typewriter").textContent!.length;
      expect(halfway).toBeGreaterThan(0);
      expect(halfway).toBeLessThan(text.length);
      rerender(
        <StoryText
          paragraphs={paragraphs}
          powerSaving={powerSaving}
          id="copy"
        />,
      );
      act(() => vi.advanceTimersByTime(1500));
      expect(screen.getByTestId("story-typewriter").textContent).toBe(text);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(0);
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("resets typing on each page and omits the reveal button while retaining approved illustrations", () => {
    render(
      <StoryPlayer
        story={story}
        powerSaving={false}
        onComplete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      story.pages[0].image,
    );
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /显示全文|全文已显示/ }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "PageDown" });
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      story.pages[1].image,
    );
    expect(screen.getByTestId("story-typewriter")).toBeEmptyDOMElement();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      story.pages[0].image,
    );
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("status")).toHaveTextContent("图片暂时无法加载");
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
  });
  it("keeps completion explicit, handles save failure, and prevents concurrent completion", async () => {
    let resolve: () => void = () => {};
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error("保存失败，请重试"))
      .mockImplementation(
        () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      );
    render(
      <StoryPlayer
        story={story}
        powerSaving={false}
        onComplete={complete}
        onClose={vi.fn()}
      />,
    );
    for (let i = 0; i < 4; i++)
      fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(
      screen.queryByRole("button", { name: "下一页" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "PageDown" });
    expect(complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存失败，请重试",
    );
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getByRole("button", { name: "正在保存…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "正在保存…" }));
    expect(complete).toHaveBeenCalledTimes(2);
    await act(async () => resolve());
  });
  it("restores modal focus and scroll, supports a focus loop and cleans up mid-typing", () => {
    const origin = document.createElement("button");
    document.body.append(origin);
    origin.focus();
    const close = vi.fn();
    const { unmount } = render(
      <StoryPlayer
        story={story}
        powerSaving={false}
        onComplete={vi.fn()}
        onClose={close}
      />,
    );
    expect(screen.getByRole("heading", { name: /1 \/ 5/ })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(screen.getByLabelText("剧情内容滚动区域")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(screen.getByRole("button", { name: "关闭剧情" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(close).toHaveBeenCalledOnce();
    unmount();
    expect(origin).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
    origin.remove();
  });
  it("accepts absent old metadata and bounded future story IDs, rejecting invalid records", () => {
    expect(validViewedStories(undefined)).toBe(true);
    expect(validViewedStories([openingStoryID, "future_story"])).toBe(true);
    for (const bad of [
      null,
      {},
      [openingStoryID, openingStoryID],
      [3],
      [""],
      ["x".repeat(129)],
      Array.from({ length: 1001 }, (_, i) => `story_${i}`),
    ])
      expect(validViewedStories(bad)).toBe(false);
  });
});
