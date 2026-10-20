import { setSamplePhotos } from "@tj/editor/theme-picker";
// Bundled sample photographs for the theme picker's picture slots (decision 72): Pexels licence,
// free to use without attribution. Lamb and ewe by Nora (pexels.com/photo/37769835), the same file
// as the e2e fixture (`e2e/fixtures/activities/lamb.jpg`).
import lamb from "@/assets/theme-picker/lamb.jpg";

/**
 * Imported for its effect: the sample lesson's "Lambs and ewes" slide shows the lamb. The sample
 * cover carries the teacher's title, so its picture slot stays open.
 */
setSamplePhotos((label) => (/lamb|ewe|sheep/i.test(label) ? lamb : ""));
