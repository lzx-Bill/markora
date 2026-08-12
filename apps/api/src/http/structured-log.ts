export interface StructuredLogEntry {
  readonly level: "info" | "warn" | "error";
  readonly service: "api" | "worker";
  readonly event: string;
  readonly requestId?: string;
  readonly jobId?: string;
  readonly actorUserId?: string;
  readonly route?: string;
  readonly method?: string;
  readonly durationMs?: number;
  readonly result?: string;
  readonly errorCode?: string;
}

export function writeStructuredLog(entry: StructuredLogEntry): void {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`);
}
