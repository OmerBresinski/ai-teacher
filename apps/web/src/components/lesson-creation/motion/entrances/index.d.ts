export function playEntrance(
  who: "plan" | "slides",
  options: {
    stage: HTMLElement;
    box: {
      left: number;
      top: number;
      width: number;
      height: number;
      shadow?: { left: number; top: number; width: number; height: number };
    };
    from?: "left" | "right" | "above" | "below";
    shake?: HTMLElement | null;
    /** The rest artwork's box, read each frame so the layer follows the rig as the stage moves. */
    follow?: () => { left: number; top: number; width: number; height: number } | null;
    onEnd?: () => void;
  },
): { cancel: () => void };
