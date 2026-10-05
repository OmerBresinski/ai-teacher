import type { PictureDirectorInput, PictureDirectorRoute } from "../prompts/picture-director";
import rows from "./picture-director.fixtures.json";

/**
 * Routing fixtures for the picture director: the 9 smoke slots of T3-R2, 15 written for coverage
 * and 3 from HISTORY-TEST. `expect` lists every route a careful teacher would accept; `split`
 * marks where separate pictures are acceptable too. The lab run scores against these.
 */
export interface DirectorFixture {
  id: string;
  input: PictureDirectorInput;
  expect: PictureDirectorRoute[];
  split?: boolean;
}

export const DIRECTOR_FIXTURES = rows as DirectorFixture[];
