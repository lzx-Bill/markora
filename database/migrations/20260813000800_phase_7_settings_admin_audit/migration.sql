CREATE TABLE "user_preferences" (
  "user_id" UUID NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "settings_json" JSONB NOT NULL DEFAULT '{}',
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "system_config" (
  "key" TEXT NOT NULL,
  "typed_value" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by" UUID NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_config_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "system_config_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "service_heartbeats" (
  "service" TEXT NOT NULL,
  "instance" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "seen_at" TIMESTAMPTZ(3) NOT NULL,
  "metadata_json" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "service_heartbeats_pkey" PRIMARY KEY ("service")
);

CREATE INDEX "service_heartbeats_seen_at_idx" ON "service_heartbeats"("seen_at");

CREATE OR REPLACE FUNCTION markora_reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_append_only_update"
BEFORE UPDATE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION markora_reject_audit_mutation();

CREATE TRIGGER "audit_events_append_only_delete"
BEFORE DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION markora_reject_audit_mutation();
