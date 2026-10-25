export const DEFAULT_TPS = 1;
export const MAX_TPS = 60;

export function validateTickRate(value: number): number {
  if (!Number.isInteger(value) || value < DEFAULT_TPS || value > MAX_TPS)
    throw new Error(`TPS 必须为 ${DEFAULT_TPS}～${MAX_TPS} 的整数`);
  return value;
}

export const tickIntervalMs = (tps: number) => 1000 / validateTickRate(tps);
