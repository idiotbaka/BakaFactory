type ConsoleRuntime = {
  readonly developerToolsVisible: boolean;
  setDeveloperToolsVisible(enabled: boolean): Promise<boolean>;
};
type DeveloperConsole = Readonly<{
  devTools: (enabled?: boolean) => boolean | Promise<boolean>;
}>;
declare global {
  interface Window {
    bakaFactory?: DeveloperConsole;
  }
}

// Only the active account owns the console entry. No simulation internals leak.
export function installDeveloperConsole(
  runtime: ConsoleRuntime,
  onHidden: () => void,
) {
  let active = true;
  const api: DeveloperConsole = Object.freeze({
    devTools(enabled?: boolean) {
      if (!active)
        throw new Error("控制台入口已失效，请使用当前登录账号的 bakaFactory");
      if (enabled === undefined) return runtime.developerToolsVisible;
      return runtime.setDeveloperToolsVisible(enabled).then((visible) => {
        if (active && !visible) onHidden();
        return visible;
      });
    },
  });
  window.bakaFactory = api;
  return () => {
    active = false;
    if (window.bakaFactory !== api) return;
    delete window.bakaFactory;
  };
}
