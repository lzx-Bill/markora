CREATE OR REPLACE FUNCTION markora_search_without_code(markdown TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT regexp_replace(
    regexp_replace(markdown, E'```[\\s\\S]*?```', ' ', 'g'),
    E'`[^`]*`',
    ' ',
    'g'
  )
$$;

-- Recompute stored generated search values for documents indexed by the original function.
UPDATE "documents" SET "markdown" = "markdown";
