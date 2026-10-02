/**
 * The demo switch (look/image-slot), set by the web app from `VITE_SHOW_SLOT_PLACEHOLDERS`
 * (`apps/web` `main.tsx`). Since TEACH-14 no renderer reads it: a slot brief is the teacher's note,
 * so the editor always draws an open photo slot and an undrawn diagram as a placeholder, and
 * present, the viewer, thumbnails and capture never do, whatever the switch says.
 */
let on = false;

export function setSlotPlaceholders(value: boolean): void {
  on = value;
}

export function slotPlaceholdersOn(): boolean {
  return on;
}
