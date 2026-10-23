import { useCallback, useState } from "react";
import type { BuildingDefinition, Catalog, FactoryDetail } from "../api/client";
import { ordersUnlocked } from "./local/progression";
import { orderRecipes } from "./local/orders";
import WarehouseOrderDialog, {
  type PlaceWorkshopOrder,
} from "./WarehouseOrderDialog";

export default function BuildingOrderButton({
  definition,
  factory,
  catalog,
  disabled,
  onOrder,
}: {
  definition: BuildingDefinition;
  factory: FactoryDetail;
  catalog: Catalog;
  disabled: boolean;
  onOrder: PlaceWorkshopOrder;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const p = factory.simulation?.industry,
    item = definition.item;
  if (
    !item ||
    !ordersUnlocked(p) ||
    !orderRecipes(p, catalog).some((r) => !!r.outputs[item])
  )
    return null;
  return (
    <>
      <button
        className="recipe-guide-trigger inspector-order-trigger"
        type="button"
        aria-haspopup="dialog"
        disabled={disabled || !!p?.workshop}
        onClick={() => setOpen(true)}
      >
        机械手下单
      </button>
      {open && (
        <WarehouseOrderDialog
          item={item}
          factory={factory}
          catalog={catalog}
          disabled={disabled}
          onConfirm={onOrder}
          onClose={close}
        />
      )}
    </>
  );
}
