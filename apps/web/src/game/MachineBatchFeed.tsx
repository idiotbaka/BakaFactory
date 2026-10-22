import { useState } from "react";
import type { BuildingDefinition, Catalog, MachineState } from "../api/client";
import type { IndustryAction } from "./local/industry";
import { machineBatchLimit, validFeedBatches } from "./local/machineFeed";

export default function MachineBatchFeed({
  id,
  recipe,
  input,
  warehouse,
  definition,
  disabled,
  act,
}: {
  id: string;
  recipe?: Catalog["recipes"][number];
  input: MachineState["input"];
  warehouse: Record<string, number>;
  definition: BuildingDefinition;
  disabled: boolean;
  act: (action: IndustryAction) => void;
}) {
  const [raw, setRaw] = useState("1");
  const requested = Number(raw);
  const valid = raw.trim() !== "" && validFeedBatches(requested);
  const maximum = recipe
    ? machineBatchLimit(
        recipe,
        input,
        warehouse,
        definition.input_slots ?? 4,
        definition.stack_limit,
      )
    : 0;
  return (
    <form
      className="machine-batch-feed"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || !recipe || !valid || maximum < 1) return;
        const batches = Math.min(requested, maximum);
        setRaw(String(batches));
        act({ type: "feed_batch", id, batches });
      }}
    >
      <input
        type="number"
        inputMode="numeric"
        aria-label="补料批数"
        title="补足的目标批数，包含机器已有原料"
        min={1}
        step={1}
        required
        value={raw}
        aria-invalid={!valid}
        disabled={disabled || !recipe}
        onChange={(event) => setRaw(event.target.value)}
      />
      <button
        type="submit"
        disabled={disabled || !recipe || !valid || maximum < 1}
      >
        从仓库补足原料
      </button>
      <p className="production-hint">
        {!recipe
          ? "请先选择配方。"
          : !Object.keys(recipe.inputs).length
            ? "该配方无需手动补料。"
            : !valid
              ? "请输入正整数批数。"
              : maximum < 1
                ? "仓库原料不足或输入格已满，无法补足一批。"
                : `最多可补足 ${maximum} 批；已有原料计入目标，超出自动按上限补料。`}
      </p>
    </form>
  );
}
