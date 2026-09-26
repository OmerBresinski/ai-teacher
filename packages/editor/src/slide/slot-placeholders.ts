/**
 * The demo and screenshot switch (look/image-slot): with it on, present and the viewer draw every
 * slot a slide keeps — an open photo slot and an undrawn diagram — as a placeholder saying what
 * the model asked for, so a screenshot shows where pictures go. Off by default. The web app turns
 * it on from `VITE_SHOW_SLOT_PLACEHOLDERS=1`, never in a production build (`apps/web` `main.tsx`);
 * export and capture never draw it. The editor always draws an open photo slot's placeholder.
 */
let on = false;

export function setSlotPlaceholders(value: boolean): void {
  on = value;
}

export function slotPlaceholdersOn(): boolean {
  return on;
}
