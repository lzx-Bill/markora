CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION markora_search_without_code(markdown TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT regexp_replace(
    regexp_replace(markdown, E'```[^`]*```', ' ', 'g'),
    E'`[^`]*`',
    ' ',
    'g'
  )
$$;

ALTER TABLE "documents"
  ADD COLUMN "search_text_with_code" TEXT GENERATED ALWAYS AS (
    "name" || E'\n' || "markdown"
  ) STORED,
  ADD COLUMN "search_text_no_code" TEXT GENERATED ALWAYS AS (
    "name" || E'\n' || markora_search_without_code("markdown")
  ) STORED,
  ADD COLUMN "search_vector_with_code" TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', "name"), 'A') ||
    setweight(to_tsvector('simple', "markdown"), 'B')
  ) STORED,
  ADD COLUMN "search_vector_no_code" TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', "name"), 'A') ||
    setweight(to_tsvector('simple', markora_search_without_code("markdown")), 'B')
  ) STORED;

CREATE INDEX "documents_search_vector_with_code_idx"
  ON "documents" USING GIN ("search_vector_with_code");
CREATE INDEX "documents_search_vector_no_code_idx"
  ON "documents" USING GIN ("search_vector_no_code");
CREATE INDEX "documents_search_text_with_code_trgm_idx"
  ON "documents" USING GIN ("search_text_with_code" gin_trgm_ops);
CREATE INDEX "documents_search_text_no_code_trgm_idx"
  ON "documents" USING GIN ("search_text_no_code" gin_trgm_ops);
CREATE INDEX "documents_name_trgm_idx"
  ON "documents" USING GIN ("name" gin_trgm_ops);
