import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database integration tests.");

const pool = new Pool({ connectionString, max: 2 });

beforeAll(async () => {
  await pool.query("SELECT 1");
});

afterAll(async () => {
  await pool.end();
});

describe("empty-to-current migration", () => {
  it("records the Phase 0 migration", async () => {
    const result = await pool.query<{ migration_name: string }>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at",
    );
    expect(result.rows.map((row) => row.migration_name)).toContain(
      "20260812000100_phase_0_foundation",
    );
    expect(result.rows.map((row) => row.migration_name)).toContain(
      "20260812000200_phase_1_identity",
    );
    expect(result.rows.map((row) => row.migration_name)).toContain(
      "20260812000300_phase_2_content",
    );
    expect(result.rows.map((row) => row.migration_name)).toContain(
      "20260812000310_phase_2_tenant_constraints",
    );
    expect(result.rows.map((row) => row.migration_name)).toContain("20260812000400_phase_3_editor");
    expect(result.rows.map((row) => row.migration_name)).toContain(
      "20260812000500_phase_4_recovery",
    );
    expect(result.rows.map((row) => row.migration_name)).toContain(
      "20260812000510_phase_4_recovery_backfill",
    );
    expect(result.rows.map((row) => row.migration_name)).toContain("20260812000600_phase_5_search");
    expect(result.rows.map((row) => row.migration_name)).toContain(
      "20260812000610_phase_5_code_search_fix",
    );
    expect(result.rows.map((row) => row.migration_name)).toContain(
      "20260813000700_phase_6_jobs_import_export",
    );
    expect(result.rows.map((row) => row.migration_name)).toContain(
      "20260813000800_phase_7_settings_admin_audit",
    );
  });

  it("supports a transaction without leaving test data", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE TEMP TABLE markora_phase0_probe (id integer PRIMARY KEY)");
      await client.query("INSERT INTO markora_phase0_probe (id) VALUES (1)");
      const result = await client.query<{ id: number }>("SELECT id FROM markora_phase0_probe");
      expect(result.rows).toEqual([{ id: 1 }]);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("installs the Phase 5 search extension, generated columns and indexes", async () => {
    const extension = await pool.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'pg_trgm'",
    );
    expect(extension.rows[0]?.extversion).toBeTruthy();
    const columns = await pool.query<{ column_name: string; is_generated: string }>(
      `SELECT column_name, is_generated
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'documents'
         AND column_name LIKE 'search_%'`,
    );
    expect(columns.rows).toEqual(
      expect.arrayContaining([
        { column_name: "search_text_with_code", is_generated: "ALWAYS" },
        { column_name: "search_text_no_code", is_generated: "ALWAYS" },
        { column_name: "search_vector_with_code", is_generated: "ALWAYS" },
        { column_name: "search_vector_no_code", is_generated: "ALWAYS" },
      ]),
    );
    const indexes = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'documents' AND indexname LIKE '%search%'`,
    );
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "documents_search_vector_with_code_idx",
        "documents_search_vector_no_code_idx",
        "documents_search_text_with_code_trgm_idx",
        "documents_search_text_no_code_trgm_idx",
      ]),
    );
  });
});
