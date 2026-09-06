import type { Id } from "@tj/domain/documents";
import {
  createContext,
  type Dispatch,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { uid } from "../model/factories";
import { erasePaths, type InkPath, type InkPoint } from "./ink";
import {
  initialPresentState,
  type PresentAction,
  type PresentState,
  presentReducer,
} from "./present-reducer";

/*
 * The present-mode session (ADR 0022 §4): deck position, tools, timer and panels in a reducer;
 * ink in a ref so a stroke's pointer moves never dispatch — `inkVersion` bumps once per committed
 * change to repaint the layers. Provided through context so `Stage`, `Controls`, the panels and
 * the key handler read one session without prop threading.
 */

export type InkApi = {
  /** Strokes per slide id, in slide coordinates. Read on render; mutated only through the api. */
  pathsFor: (slideId: Id) => InkPath[];
  addPath: (slideId: Id, path: Omit<InkPath, "id">) => void;
  eraseAt: (slideId: Id, at: InkPoint) => void;
  clearInk: (slideId: Id) => void;
  hasInk: (slideId: Id) => boolean;
  /** Changes whenever a stroke is added, erased or cleared — subscribe to repaint. */
  inkVersion: number;
};

export type PresentSession = {
  state: PresentState;
  dispatch: Dispatch<PresentAction>;
  ink: InkApi;
};

const EMPTY: InkPath[] = [];

export function usePresentSession(): PresentSession {
  const [state, dispatch] = useReducer(presentReducer, undefined, () => initialPresentState());
  const inkRef = useRef<Record<Id, InkPath[]>>({});
  const [inkVersion, setInkVersion] = useState(0);
  const bump = useCallback(() => setInkVersion((v) => v + 1), []);

  const pathsFor = useCallback((slideId: Id) => inkRef.current[slideId] ?? EMPTY, []);
  const hasInk = useCallback((slideId: Id) => (inkRef.current[slideId]?.length ?? 0) > 0, []);
  const addPath = useCallback(
    (slideId: Id, path: Omit<InkPath, "id">) => {
      inkRef.current[slideId] = [...(inkRef.current[slideId] ?? []), { ...path, id: uid() }];
      bump();
    },
    [bump],
  );
  const eraseAt = useCallback(
    (slideId: Id, at: InkPoint) => {
      const paths = inkRef.current[slideId];
      if (!paths || paths.length === 0) return;
      const next = erasePaths(paths, at);
      if (next === paths) return;
      inkRef.current[slideId] = next;
      bump();
    },
    [bump],
  );
  const clearInk = useCallback(
    (slideId: Id) => {
      if (!inkRef.current[slideId]?.length) return;
      delete inkRef.current[slideId];
      bump();
    },
    [bump],
  );

  const ink = useMemo<InkApi>(
    () => ({ pathsFor, addPath, eraseAt, clearInk, hasInk, inkVersion }),
    [pathsFor, addPath, eraseAt, clearInk, hasInk, inkVersion],
  );

  return useMemo(() => ({ state, dispatch, ink }), [state, ink]);
}

export const PresentSessionContext = createContext<PresentSession | null>(null);

export function usePresent(): PresentSession {
  const session = useContext(PresentSessionContext);
  if (!session) throw new Error("usePresent() must be used inside <PresentView>.");
  return session;
}
