const key = "bakafactory:power-saving";
export function readPowerSaving(): boolean {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) return saved === "true";
  } catch {
    // Blocked storage must not prevent playing.
  }
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
export function savePowerSaving(enabled: boolean) {
  try {
    localStorage.setItem(key, String(enabled));
  } catch {
    // Keep the preference in memory when storage is unavailable.
  }
}
