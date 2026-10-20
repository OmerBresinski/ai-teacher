import { setSamplePhotos } from "@tj/editor/theme-picker";
// Bundled sample photographs for the theme picker's picture slots (decision 72): Pexels licence,
// free to use without attribution. Chicks by Umar S (pexels.com/photo/37884976), lamb and ewe by
// Nora (pexels.com/photo/37769835); the same files as the e2e fixtures (`e2e/fixtures/activities`).
import chicks from "@/assets/theme-picker/chicks.jpg";
import lamb from "@/assets/theme-picker/lamb.jpg";

/** Imported for its effect: the picker's covers show chicks, its picture slides a lamb. */
setSamplePhotos((label) => (/lamb|ewe|sheep/i.test(label) ? lamb : chicks));
