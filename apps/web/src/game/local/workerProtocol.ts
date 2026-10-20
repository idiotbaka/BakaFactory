import type { User } from "../../api/client";
import type { Edit, LocalFactory } from "./state";

export type WorkerCommand =
  | { kind: "init"; factory: LocalFactory | null }
  | { kind: "permit"; enabled: boolean; validFor: number }
  | { kind: "create"; request: number; user: User; name: string }
  | { kind: "edit"; request: number; edit: Edit }
  | { kind: "replace"; request: number; factory: LocalFactory };
export type WorkerEvent =
  | { kind: "state"; factory: LocalFactory; request?: number }
  | { kind: "error"; message: string; request?: number };
