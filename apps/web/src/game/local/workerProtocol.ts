import type { User } from "../../api/client";
import type { Edit, LocalFactory } from "./state";
import type { DistrictSummary, WorldAction } from "./world";

export type WorkerCommand =
  | { kind: "init"; factory: LocalFactory | null }
  | { kind: "permit"; enabled: boolean; validFor: number }
  | { kind: "create"; request: number; user: User; name: string }
  | { kind: "edit"; request: number; edit: Edit; factoryID?: string }
  | { kind: "world"; request: number; action: WorldAction }
  | { kind: "replace"; request: number; factory: LocalFactory };
export type WorkerEvent =
  | {
      kind: "state";
      factory: LocalFactory;
      root?: LocalFactory;
      districts?: DistrictSummary[];
      request?: number;
    }
  | { kind: "error"; message: string; request?: number };
