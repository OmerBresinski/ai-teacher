import type { RigPose } from "./motion/handover-rig.js";

export interface CharacterOrigin {
  bounds: { left: number; top: number; width: number; height: number };
  pose: RigPose;
}
export interface CharacterCapture {
  capture(): CharacterOrigin | null;
}
