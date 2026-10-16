import { z } from "zod";

export const DbConnectionSchema = z
  .object({
    label: z.string().min(1, "Label is required"),
    host: z.string().optional(),
    port: z.coerce.number().int().positive().default(50000),
    user: z.string().optional(),
    password: z.string().default(""),
    database: z.string().optional(),
    url: z.string().optional(),
    enabled: z.boolean().default(true),
    readOnly: z.boolean().default(true),
    timeout: z.coerce.number().int().positive().default(10_000),
    replySize: z.coerce.number().int().default(-1),
  })
  .refine((c) => c.url || (c.host && c.user && c.database), {
    message: "Provide either 'url' or 'host' + 'user' + 'database'",
  });

/** Connection details supplied at runtime via mdb_connect (not stored in config). */
export const DynamicConnectionInputSchema = z
  .object({
    host: z.string().optional(),
    port: z.coerce.number().int().positive().default(50000),
    user: z.string().optional(),
    password: z.string().default(""),
    database: z.string().optional(),
    url: z.string().optional(),
    readOnly: z.boolean().default(true),
    timeout: z.coerce.number().int().positive().default(10_000),
    replySize: z.coerce.number().int().default(-1),
  })
  .refine((c) => c.url || (c.host && c.user && c.database), {
    message: "Provide either 'url' or 'host' + 'user' + 'database'",
  });

export const DbConfigSchema = z.object({
  connections: z.union([
    z.array(DbConnectionSchema),
    z.record(z.string(), DbConnectionSchema),
  ]),
});
