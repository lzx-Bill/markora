CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "username" TEXT NOT NULL,
  "username_canonical" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "email_canonical" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'USER',
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspaces" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "family_id" UUID NOT NULL,
  "user_agent_summary" TEXT NOT NULL,
  "last_active_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor_user_id" UUID,
  "workspace_id" UUID,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "result" "AuditResult" NOT NULL,
  "request_id" TEXT NOT NULL,
  "metadata_json" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "login_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subject_hash" TEXT NOT NULL,
  "network_hash" TEXT NOT NULL,
  "window_start" TIMESTAMPTZ(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "blocked_until" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_username_canonical_key" ON "users"("username_canonical");
CREATE UNIQUE INDEX "users_email_canonical_key" ON "users"("email_canonical");
CREATE UNIQUE INDEX "workspaces_owner_user_id_key" ON "workspaces"("owner_user_id");
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_revoked_at_expires_at_idx" ON "sessions"("user_id", "revoked_at", "expires_at");
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at" DESC);
CREATE INDEX "audit_events_actor_user_id_action_result_idx" ON "audit_events"("actor_user_id", "action", "result");
CREATE UNIQUE INDEX "login_attempts_subject_hash_network_hash_window_start_key" ON "login_attempts"("subject_hash", "network_hash", "window_start");
CREATE INDEX "login_attempts_blocked_until_idx" ON "login_attempts"("blocked_until");

ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
