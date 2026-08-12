import { performance } from "node:perf_hooks";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString?.includes("markora_test")) {
  throw new Error("Search benchmark requires DATABASE_URL to target markora_test.");
}

const pool = new Pool({ connectionString, max: 2 });
const corpusSize = 10_000;
const iterations = 40;
const cases = [
  { query: "distributed systems", expectedId: 1, language: "en" },
  { query: "consensus", expectedId: 1, language: "en" },
  { query: "分布式系统", expectedId: 2, language: "zh" },
  { query: "分布式", expectedId: 2, language: "zh" },
  { query: "一致性", expectedId: 2, language: "zh" },
  { query: "全文検索", expectedId: 3, language: "ja" },
  { query: "日本語", expectedId: 3, language: "ja" },
] as const;

type Strategy = "simple_fts" | "trigram" | "hybrid";

try {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await pool.query("DROP TABLE IF EXISTS markora_search_benchmark");
  await pool.query(`
    CREATE UNLOGGED TABLE markora_search_benchmark (
      id integer PRIMARY KEY,
      name text NOT NULL,
      path text NOT NULL,
      markdown text NOT NULL,
      search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', name), 'A') ||
        setweight(to_tsvector('simple', path), 'B') ||
        setweight(to_tsvector('simple', markdown), 'C')
      ) STORED
    )
  `);
  await pool.query(
    `INSERT INTO markora_search_benchmark (id, name, path, markdown)
     SELECT value,
       CASE value
         WHEN 1 THEN 'Distributed Systems Handbook.md'
         WHEN 2 THEN '中文知识库.md'
         WHEN 3 THEN '検索設計.md'
         ELSE 'Reference ' || lpad(value::text, 5, '0') || '.md'
       END,
       CASE value
         WHEN 1 THEN '/Engineering/Distributed Systems Handbook.md'
         WHEN 2 THEN '/研究/中文知识库.md'
         WHEN 3 THEN '/設計/検索設計.md'
         ELSE '/Archive/Reference ' || lpad(value::text, 5, '0') || '.md'
       END,
       CASE value
         WHEN 1 THEN '# Distributed systems\nConsensus, replication and fault tolerance.'
         WHEN 2 THEN '# 中文知识库\n分布式系统的一致性协议与故障恢复。'
         WHEN 3 THEN '# 全文検索\n日本語の検索品質と関連度を検証する。'
         ELSE '# Reference ' || value || E'\nordinary benchmark filler about notes and writing'
       END
     FROM generate_series(1, $1) value`,
    [corpusSize],
  );
  await pool.query(
    "CREATE INDEX markora_search_benchmark_fts_idx ON markora_search_benchmark USING GIN (search_vector)",
  );
  await pool.query(
    "CREATE INDEX markora_search_benchmark_trgm_idx ON markora_search_benchmark USING GIN ((name || ' ' || path || ' ' || markdown) gin_trgm_ops)",
  );
  await pool.query("ANALYZE markora_search_benchmark");

  const results: Record<string, unknown> = {};
  for (const strategy of ["simple_fts", "trigram", "hybrid"] as const) {
    const latencies: number[] = [];
    const relevance: Array<{ query: string; language: string; rank: number | null }> = [];
    for (const item of cases) {
      const rows = await search(strategy, item.query);
      const rank = rows.findIndex((row) => row.id === item.expectedId);
      relevance.push({
        query: item.query,
        language: item.language,
        rank: rank < 0 ? null : rank + 1,
      });
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const startedAt = performance.now();
        await search(strategy, item.query);
        latencies.push(performance.now() - startedAt);
      }
    }
    latencies.sort((left, right) => left - right);
    results[strategy] = {
      hitAt5: relevance.filter(({ rank }) => rank !== null && rank <= 5).length / relevance.length,
      relevance,
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
      },
    };
  }
  const environment = await pool.query<{ version: string }>("SELECT version()");
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        corpus: { documents: corpusSize, cases: cases.length, iterationsPerCase: iterations },
        environment: environment.rows[0]?.version,
        provisionalBudgetMs: { p95: 500 },
        results,
        decision: "hybrid",
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await pool.query("DROP TABLE IF EXISTS markora_search_benchmark");
  await pool.end();
}

async function search(strategy: Strategy, query: string): Promise<Array<{ id: number }>> {
  if (strategy === "simple_fts") {
    return (
      await pool.query<{ id: number }>(
        `SELECT id FROM markora_search_benchmark
         WHERE search_vector @@ plainto_tsquery('simple', $1)
         ORDER BY ts_rank_cd(search_vector, plainto_tsquery('simple', $1)) DESC, id
         LIMIT 5`,
        [query],
      )
    ).rows;
  }
  if (strategy === "trigram") {
    return (
      await pool.query<{ id: number }>(
        `SELECT id FROM markora_search_benchmark
         WHERE (name || ' ' || path || ' ' || markdown) ILIKE '%' || $1 || '%'
         ORDER BY
           CASE WHEN (name || ' ' || path || ' ' || markdown) ILIKE '%' || $1 || '%' THEN 1 ELSE 0 END DESC,
           similarity(name || ' ' || path || ' ' || markdown, $1) DESC,
           id
         LIMIT 5`,
        [query],
      )
    ).rows;
  }
  return (
    await pool.query<{ id: number }>(
      `SELECT id FROM markora_search_benchmark
       WHERE search_vector @@ plainto_tsquery('simple', $1)
          OR (name || ' ' || path || ' ' || markdown) ILIKE '%' || $1 || '%'
       ORDER BY
         CASE WHEN name ILIKE $1 || '%' THEN 4 ELSE 0 END +
         CASE WHEN (name || ' ' || path || ' ' || markdown) ILIKE '%' || $1 || '%' THEN 2 ELSE 0 END +
         ts_rank_cd(search_vector, plainto_tsquery('simple', $1)) +
         similarity(name || ' ' || path || ' ' || markdown, $1) DESC,
         id
       LIMIT 5`,
      [query],
    )
  ).rows;
}

function percentile(values: readonly number[], fraction: number): number {
  const index = Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1);
  return Number((values[index] ?? 0).toFixed(3));
}
