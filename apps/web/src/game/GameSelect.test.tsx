import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GameSelect from "./GameSelect";
import { catalog } from "./local/catalog";
import { openGameSelect } from "../test/gameSelect";

afterEach(() => vi.restoreAllMocks());
const first = catalog.items.find((i) => i.tier === 1)!;
const second = catalog.items.find((i) => i.tier === 2)!;

describe("custom game selects", () => {
  it("filters eligible item choices by phase and code, renders sprites, and restores focus on selection", () => {
    const change = vi.fn();
    render(
      <GameSelect
        catalog={catalog}
        kind="item"
        aria-label="过滤物品"
        value=""
        onValueChange={change}
      >
        <option value="">任意物品</option>
        <option value={first.id}>{first.name}</option>
        <option value={second.id}>{second.name}</option>
      </GameSelect>,
    );
    const trigger = screen.getByRole("combobox", { name: "过滤物品" });
    openGameSelect(trigger);
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "P2" }));
    expect(
      screen.queryByRole("option", { name: first.name }),
    ).not.toBeInTheDocument();
    const choice = screen.getByRole("option", {
      name: second.name,
    });
    expect(
      choice.querySelector(`.item-sprite[data-item-id="${second.id}"]`),
    ).not.toBeNull();
    fireEvent.change(screen.getByLabelText("搜索物品"), {
      target: { value: second.code },
    });
    fireEvent.click(screen.getByRole("option", { name: second.name }));
    expect(change).toHaveBeenCalledExactlyOnceWith(second.id);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("shows a single recipe list with exact quantities, all output sprites, and disabled locked rows", () => {
    const recipe = {
      ...catalog.recipes[0],
      id: "visual-recipe",
      name: "图示配方",
      duration_ms: 1500,
      inputs: { [first.id]: 3 },
      outputs: { [second.id]: 2, [first.id]: 1 },
    };
    const locked = { ...recipe, id: "locked-recipe", name: "未解锁配方" };
    const change = vi.fn();
    render(
      <GameSelect
        catalog={{ ...catalog, recipes: [recipe, locked] }}
        kind="recipe"
        aria-label="配方"
        value=""
        onValueChange={change}
      >
        <option value="" disabled>
          选择配方
        </option>
        <option value={recipe.id}>{recipe.name}</option>
        <option value={locked.id} disabled>
          {locked.name}
        </option>
      </GameSelect>,
    );
    openGameSelect(screen.getByRole("combobox", { name: "配方" }));
    expect(
      screen.queryByRole("group", { name: "物品阶段筛选" }),
    ).not.toBeInTheDocument();
    const row = screen.getByRole("option", { name: /图示配方/ });
    expect(row).toHaveTextContent(`3× ${first.name}`);
    expect(row).toHaveTextContent(`2× ${second.name}`);
    expect(row).toHaveTextContent(`1× ${first.name}`);
    expect(row.querySelectorAll(".item-sprite")).toHaveLength(3);
    const blocked = screen.getByRole("option", { name: /未解锁配方/ });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(blocked);
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("搜索配方或原料、产物"), {
      target: { value: second.name },
    });
    expect(
      screen.getByRole("option", { name: /图示配方/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /图示配方/ }));
    expect(change).toHaveBeenCalledExactlyOnceWith(recipe.id);
  });

  it("isolates gameplay keys, skips disabled options with arrows, and lets Escape close without changing the value", () => {
    const change = vi.fn(),
      gameKey = vi.fn();
    window.addEventListener("keydown", gameKey);
    try {
      render(
        <GameSelect
          catalog={catalog}
          aria-label="方向"
          value="east"
          onValueChange={change}
        >
          <option value="east">东</option>
          <option value="locked" disabled>
            未开放
          </option>
          <option value="west">西</option>
        </GameSelect>,
      );
      const trigger = screen.getByRole("combobox", { name: "方向" });
      openGameSelect(trigger);
      const list = screen.getByRole("listbox");
      fireEvent.keyDown(list, { key: "d" });
      fireEvent.keyDown(list, { key: "Delete" });
      expect(gameKey).not.toHaveBeenCalled();
      fireEvent.keyDown(list, { key: "ArrowDown" });
      const active = document.getElementById(
        list.getAttribute("aria-activedescendant")!,
      )!;
      expect(active).toHaveTextContent("西");
      fireEvent.keyDown(list, { key: "Enter" });
      expect(change).toHaveBeenCalledExactlyOnceWith("west");
      openGameSelect(trigger);
      fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
      expect(change).toHaveBeenCalledTimes(1);
      expect(trigger).toHaveFocus();
    } finally {
      window.removeEventListener("keydown", gameKey);
    }
  });

  it("closes on outside interaction and does not reopen after disabling and enabling the control", () => {
    const props = {
      catalog,
      "aria-label": "选项",
      value: "a",
      onValueChange: vi.fn(),
    };
    const { rerender } = render(
      <GameSelect {...props}>
        <option value="a">甲</option>
        <option value="b">乙</option>
      </GameSelect>,
    );
    const trigger = screen.getByRole("combobox", { name: "选项" });
    const list = openGameSelect(trigger);
    expect(list.getAllByRole("option")).toHaveLength(2);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    openGameSelect(trigger);
    rerender(
      <GameSelect {...props} disabled>
        <option value="a">甲</option>
      </GameSelect>,
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    rerender(
      <GameSelect {...props}>
        <option value="a">甲</option>
      </GameSelect>,
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(within(trigger).getByText("甲")).toBeInTheDocument();
  });
});
