import type { RigPose } from "./motion/handover-rig.js";

export interface CharacterOrigin {
  bounds: { left: number; top: number; width: number; height: number };
  pose: RigPose;
}
export interface CharacterCapture {
  capture(): CharacterOrigin | null;
}

export const CHARACTER_ENTRY_SECONDS = 0.6;
