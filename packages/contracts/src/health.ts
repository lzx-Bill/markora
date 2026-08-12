import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "not_ready"]),
  service: z.enum(["api", "worker"]),
  version: z.string(),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
