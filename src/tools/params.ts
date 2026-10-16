import { z } from "zod";

export const optionalDatabaseParam = z
  .string()
  .optional()
  .describe(
    "Config label from config.json (e.g. 'analytics'). Required when using pre-configured databases and no dynamic session is active. Omit entirely when mdb_connect has established a runtime session."
  );
