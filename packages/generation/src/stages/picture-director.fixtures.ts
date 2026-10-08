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
  /**
   * BAKEOFF (9 Oct, Greg's ruling on stage animals): the routes expected under a lab arm that runs a
   * different director (dir-stage and y1fix run v12: an adult with its young is generated). Other
   * arms score `expect`.
   */
  expectByArm?: Record<string, PictureDirectorRoute[]>;
}

/** The routes a fixture expects under an arm (its `expectByArm` entry, else `expect`). */
export const expectedRoutes = (f: DirectorFixture, arm?: string): PictureDirectorRoute[] =>
  (arm && f.expectByArm?.[arm]) || f.expect;

export const DIRECTOR_FIXTURES = rows as DirectorFixture[];
