import type { MachineState } from "../../api/client";
export const newMachine = (): MachineState => ({
  input: [],
  output: [],
  progress: 0,
  duration: 0,
  cooldown: 0,
  status: "idle",
});
