import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { User } from "../../api/client";
import { GameRuntime, type GameView } from "./runtime";
import { gameAssetPreloader } from "../gameAssets";

export function useLocalGame(user: User, onSessionExpired: () => void) {
  const [identity] = useState(user);
  const closing = useRef<Promise<void>>(Promise.resolve());
  const [attempt, setAttempt] = useState(0);
  const resources = useSyncExternalStore(
    gameAssetPreloader.subscribe,
    gameAssetPreloader.getSnapshot,
  );
  const initial = (): GameView => ({
    ready: false,
    factory: null,
    error: "",
    message: "",
    online: false,
    conflict: false,
    uploading: false,
    localSavedAt: null,
    cloudSavedAt: null,
    dirty: false,
    paused: true,
  });
  const [state, setState] = useState<{
    runtime: GameRuntime | null;
    view: GameView;
  }>(() => ({ runtime: null, view: initial() }));
  useEffect(() => {
    let active = true;
    let game: GameRuntime | undefined;
    void closing.current.then(async () => {
      if (!active) return;
      await gameAssetPreloader.start();
      if (!active || gameAssetPreloader.getSnapshot().phase !== "ready") return;
      const runtime = new GameRuntime(
        identity,
        (next) => {
          if (active) setState({ runtime, view: next });
        },
        onSessionExpired,
      );
      game = runtime;
      await runtime.start();
    });
    return () => {
      active = false;
      if (game) closing.current = game.close();
    };
  }, [identity, attempt, onSessionExpired]); // AccountPanel keys the component by owner.
  return {
    ...state.view,
    resources,
    runtime: state.runtime,
    retry: () => {
      setState({ runtime: null, view: initial() });
      setAttempt((v) => v + 1);
    },
  };
}
