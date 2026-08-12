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
});
