import { useEffect, useRef, useState } from "react";
import type { User } from "../../api/client";
import { GameRuntime, type GameView } from "./runtime";

export function useLocalGame(user: User, onSessionExpired: () => void) {
  const [identity] = useState(user);
  const closing = useRef<Promise<void>>(Promise.resolve());
  const [attempt, setAttempt] = useState(0);
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
    const game = new GameRuntime(
      identity,
      (next) => {
        if (active) setState({ runtime: game, view: next });
      },
      onSessionExpired,
    );
    void closing.current.then(() => {
      if (active) return game.start();
    });
    return () => {
      active = false;
      closing.current = game.close();
    };
  }, [identity, attempt, onSessionExpired]); // AccountPanel keys the component by owner.
  return {
    ...state.view,
    runtime: state.runtime,
    retry: () => {
      setState({ runtime: null, view: initial() });
      setAttempt((v) => v + 1);
    },
  };
}
