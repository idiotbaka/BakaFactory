import type { Catalog } from "../apps/web/src/api/client";
export function auditClosure(c: Catalog): {
  stage: number;
  reached: string[];
  items: string[];
  capabilities: string[];
  witnesses: (
    { recipe: string; stage: number } | { capability: string; stage: number }
  )[];
  milestones: { tier: number; item: string; reached: boolean }[];
  unreachable: { id: string; reasons: string[] }[];
};
