export function playPlanEntrance(options: {
  stage: HTMLElement;
  box: {
    left: number;
    top: number;
    width: number;
    height: number;
    shadow?: { left: number; top: number; width: number; height: number };
  };
  onEnd?: () => void;
}): { cancel: () => void };
