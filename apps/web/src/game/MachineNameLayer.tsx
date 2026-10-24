import { memo, useMemo } from "react";
import type { BuildingDefinition, Catalog, FactoryDetail } from "../api/client";
import type { Camera, Cell } from "./editorGeometry";
import {
  MACHINE_NAME_MIN_ZOOM,
  machineMapName,
  machineNamePosition,
} from "./machineMapNames";

function MachineNameLayer({
  factory,
  catalog,
  camera,
  preview,
}: {
  factory: Pick<FactoryDetail, "width" | "height" | "buildings">;
  catalog: Catalog;
  camera: Camera;
  preview?: {
    definition: BuildingDefinition;
    cell: Cell | null;
    instanceID?: string;
    invalid: boolean;
  };
}) {
  const definitions = useMemo(
    () => new Map(catalog.buildings.map((d) => [d.id, d])),
    [catalog],
  );
  // Match the rounded percentage shown by the camera toolbar.
  if (Math.round(camera.zoom * 100) < MACHINE_NAME_MIN_ZOOM * 100) return null;
  const target = preview?.cell;
  const render = (
    definition: BuildingDefinition | undefined,
    cell: Cell,
    id: string,
    invalid = false,
  ) => {
    const name = definition && machineMapName(definition);
    return name ? (
      <span
        key={id}
        className={`machine-map-name${invalid ? " is-invalid-preview" : ""}`}
        data-label-for={id}
        data-building-type={definition.id}
        style={machineNamePosition(factory, camera, cell)}
      >
        {name}
      </span>
    ) : null;
  };
  const targetInGrid =
    target &&
    target.x + Math.floor(factory.width / 2) >= 0 &&
    target.x + Math.floor(factory.width / 2) < factory.width &&
    Math.floor(factory.height / 2) - target.y >= 0 &&
    Math.floor(factory.height / 2) - target.y < factory.height;
  return (
    <div className="machine-name-layer" aria-hidden="true">
      {factory.buildings.map((instance) => {
        if (
          instance.id === preview?.instanceID ||
          (target && instance.x === target.x && instance.y === target.y)
        )
          return null;
        return render(
          definitions.get(instance.building_type),
          instance,
          instance.id,
        );
      })}
      {preview &&
        targetInGrid &&
        render(
          preview.definition,
          target,
          "placement-preview",
          preview.invalid,
        )}
    </div>
  );
}
export default memo(MachineNameLayer);
