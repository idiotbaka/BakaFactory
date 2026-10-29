import type { components } from "../api/schema";
import type { BuildingInstance } from "../api/client";

export type PickedRobotEndpoint = components["schemas"]["RobotEndpoint"] & {
  label: string;
};
export type RobotTaskDraft = {
  sourceZone: string;
  targetZone: string;
  source?: PickedRobotEndpoint;
  target?: PickedRobotEndpoint;
  item: string;
  count: number;
  channel: components["schemas"]["RobotTask"]["channel"];
  repeat: boolean;
};
export const newRobotTaskDraft = (factoryID: string): RobotTaskDraft => ({
  sourceZone: factoryID,
  targetZone: factoryID,
  item: "",
  count: 1,
  channel: "auto",
  repeat: true,
});
export type RobotTaskDraftControls = {
  taskDraft?: RobotTaskDraft;
  onTaskDraftChange?: (draft: RobotTaskDraft) => void;
  onPickEndpoints?: (robotID: string) => void;
  pickingEndpoints?: boolean;
};
export type RobotEndpointPicker = {
  robotID: string;
  source?: PickedRobotEndpoint;
};
export type RobotEndpointSelection = {
  step: "source" | "target";
  source?: PickedRobotEndpoint;
  allowedFactories: string[];
  issue: (building?: BuildingInstance) => string | null;
  onPick: (building: BuildingInstance) => void;
  onCancel: () => void;
};
