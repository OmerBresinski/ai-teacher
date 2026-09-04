import type { Logger } from "./logger";

/** Per-request variables set by the middleware in `app.ts`. */
export type AppEnv = {
  Variables: {
    requestId: string;
    logger: Logger;
  };
};
