import type { Element } from "happy-dom";

/** The diagram library's model contract as production uses it (lab/library/kit/contract.js). */
export type J = Record<string, unknown>;
export type LibMeta = {
  id: string;
  name: string;
  years: string[];
  subjects?: string[];
  teaches: string;
};
export type LibParams = J & { properties: Record<string, J>; required?: string[] };
export type LibPreset = { id: string; name: string; params: J };
export type LibRefusal = { path: string; reason: string };
export type LibModel = {
  meta: LibMeta;
  params: LibParams;
  presets: LibPreset[];
  validate: (p: J) => { ok: boolean; refusals: LibRefusal[]; warnings: string[] };
  builds?: (p: J) => { steps: { key: string; caption?: string }[] };
};
/** The kit's mounted slide (kit/build.js `mountSlide`), the parts production reads. */
export type LibStage = {
  N: number;
  svg: Element;
  slide: Element;
  alt?: string;
  warnings?: string[];
  drawn?: { name: string; as?: string }[];
  show: (k: number, instant?: boolean) => void;
  caption: (k?: number) => string;
  destroy: () => void;
};
