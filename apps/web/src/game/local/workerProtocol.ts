import type { User } from "../../api/client";
import type { Edit, LocalFactory } from "./state";
import type { DistrictSummary, WorldAction } from "./world";
import type { WorldFrame } from "./worldFrame";
import type { Observation } from "./observations";

export type WorkerCommand =
  | { kind: "init"; factory: LocalFactory | null }
  | { kind: "permit"; enabled: boolean; validFor: number; tickRate?: number }
  | { kind: "create"; request: number; user: User; name: string }
  | { kind: "edit"; request: number; edit: Edit; factoryID?: string }
  | { kind: "world"; request: number; action: WorldAction }
  | { kind: "replace"; request: number; factory: LocalFactory };
export type WorkerEvent =
  | {
      kind: "delta";
      frame: WorldFrame;
      observation?: Observation;
      request?: never;
    }
  | {
      kind: "state";
      factory: LocalFactory;
      root?: LocalFactory;
      districts?: DistrictSummary[];
      request?: number;
      observation?: Observation;
    }
  | { kind: "error"; message: string; request?: number };
