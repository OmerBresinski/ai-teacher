import type { ComponentProps } from "react";
import { lazyLoader } from "../../kit/LazyPart";
import type { FreeLayoutSwitch } from "./FreeLayoutSwitch";

export type FreeLayoutSwitchProps = ComponentProps<typeof FreeLayoutSwitch>;

/** The "Free layout" switch's chunk (bundle budget, TEACH-205 part b); a failed import retries. */
export const freeLayoutSwitch = lazyLoader<FreeLayoutSwitchProps>(() =>
  import("./FreeLayoutSwitch").then((m) => m.FreeLayoutSwitch),
);
