import type { RigPose } from "./motion/handover-rig.js";

export interface CharacterOrigin {
  bounds: { left: number; top: number; width: number; height: number };
  pose: RigPose;
}
export interface CharacterCapture {
  capture(): CharacterOrigin | null;
}

export const CHARACTER_ENTRY_SECONDS = 0.6;

/** Persona tempo (timeScale) per owner: Plan calm, Slides lively, Worksheet brisk, Check exact. */
export const PERSONA_SPEED = [1, 1.35, 1.4, 1.3];
