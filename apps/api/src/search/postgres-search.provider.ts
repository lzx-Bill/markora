import type { QuickOpenItem, SearchQuery } from "@markora/contracts";
import { Prisma } from "@markora/database";
import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service.js";
import type { SearchProvider, SearchProviderPage, SearchProviderRow } from "./search.provider.js";

interface RawSearchRow {
  document_id: string;
  name: string;
  path: string;
  markdown: string;
  score: number;
}

interface RawQuickOpenRow {
  document_id: string;
  name: string;
  path: string;
  updated_at: Date;
}

@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  @Inject(DatabaseService)
  private readonly database!: DatabaseService;

  public async search(
    workspaceId: string,
    query: SearchQuery,
    offset: number,
  ): Promise<SearchProviderPage> {
    const searchText = Prisma.raw(
      query.includeCodeBlocks ? '"search_text_with_code"' : '"search_text_no_code"',
    );
    const searchVector = Prisma.raw(
      query.includeCodeBlocks ? '"search_vector_with_code"' : '"search_vector_no_code"',
    );
    const scope = this.scopeSql(query);
    const rows = await this.database.client.$queryRaw<RawSearchRow[]>(Prisma.sql`
      WITH RECURSIVE folder_paths AS (
        SELECT
          folder.id,
          folder.parent_id,
          '/' || folder.name AS path,
          ARRAY[folder.id]::uuid[] AS ancestor_ids
        FROM folders folder
        WHERE folder.workspace_id = ${workspaceId}::uuid
          AND folder.state = 'ACTIVE'
          AND folder.parent_id IS NULL
        UNION ALL
        SELECT
          child.id,
          child.parent_id,
          parent.path || '/' || child.name,
          parent.ancestor_ids || child.id
        FROM folders child
        JOIN folder_paths parent ON child.parent_id = parent.id
        WHERE child.workspace_id = ${workspaceId}::uuid
          AND child.state = 'ACTIVE'
      ), candidates AS (
        SELECT
          document.id AS document_id,
          document.name,
          CASE
            WHEN document.folder_id IS NULL THEN '/' || document.name
            ELSE folder.path || '/' || document.name
          END AS path,
          document.markdown,
          document.${searchText} AS search_text,
          document.${searchVector} AS search_vector
        FROM documents document
        LEFT JOIN folder_paths folder ON document.folder_id = folder.id
        WHERE document.workspace_id = ${workspaceId}::uuid
          AND document.state = 'ACTIVE'
          AND (document.folder_id IS NULL OR folder.id IS NOT NULL)
          AND ${scope}
      ), ranked AS (
        SELECT
          document_id,
          name,
          path,
          markdown,
          (
            CASE WHEN lower(name) = lower(${query.q}) THEN 8 ELSE 0 END +
            CASE WHEN name ILIKE ${`${escapeLike(query.q)}%`} ESCAPE '\\' THEN 4 ELSE 0 END +
            CASE WHEN path ILIKE ${`%${escapeLike(query.q)}%`} ESCAPE '\\' THEN 2 ELSE 0 END +
            CASE WHEN search_text ILIKE ${`%${escapeLike(query.q)}%`} ESCAPE '\\' THEN 2 ELSE 0 END +
            ts_rank_cd(search_vector, plainto_tsquery('simple', ${query.q})) +
            similarity(search_text, ${query.q})
          )::double precision AS score
        FROM candidates
        WHERE search_vector @@ plainto_tsquery('simple', ${query.q})
           OR search_text ILIKE ${`%${escapeLike(query.q)}%`} ESCAPE '\\'
           OR path ILIKE ${`%${escapeLike(query.q)}%`} ESCAPE '\\'
      )
      SELECT document_id, name, path, markdown, score
      FROM ranked
      ORDER BY score DESC, document_id
      LIMIT 51 OFFSET ${offset}
    `);
    return {
      data: rows.slice(0, 50).map(searchRow),
      hasMore: rows.length > 50,
    };
  }

  public async quickOpen(workspaceId: string, query: string): Promise<readonly QuickOpenItem[]> {
    const pattern = `%${escapeLike(query)}%`;
    const rows = await this.database.client.$queryRaw<RawQuickOpenRow[]>(Prisma.sql`
      WITH RECURSIVE folder_paths AS (
        SELECT folder.id, folder.parent_id, '/' || folder.name AS path
        FROM folders folder
        WHERE folder.workspace_id = ${workspaceId}::uuid
          AND folder.state = 'ACTIVE'
          AND folder.parent_id IS NULL
        UNION ALL
        SELECT child.id, child.parent_id, parent.path || '/' || child.name
        FROM folders child
        JOIN folder_paths parent ON child.parent_id = parent.id
        WHERE child.workspace_id = ${workspaceId}::uuid
          AND child.state = 'ACTIVE'
      ), visible AS (
        SELECT
          document.id AS document_id,
          document.name,
          CASE
            WHEN document.folder_id IS NULL THEN '/' || document.name
            ELSE folder.path || '/' || document.name
          END AS path,
          document.updated_at
        FROM documents document
        LEFT JOIN folder_paths folder ON document.folder_id = folder.id
        WHERE document.workspace_id = ${workspaceId}::uuid
          AND document.state = 'ACTIVE'
          AND (document.folder_id IS NULL OR folder.id IS NOT NULL)
      )
      SELECT document_id, name, path, updated_at
      FROM visible
      WHERE ${query.length === 0} OR name ILIKE ${pattern} ESCAPE '\\' OR path ILIKE ${pattern} ESCAPE '\\'
      ORDER BY
        CASE WHEN ${query.length > 0} AND lower(name) = lower(${query}) THEN 6 ELSE 0 END +
        CASE WHEN ${query.length > 0} AND name ILIKE ${`${escapeLike(query)}%`} ESCAPE '\\' THEN 3 ELSE 0 END +
        CASE WHEN ${query.length > 0} THEN similarity(name || ' ' || path, ${query}) ELSE 0 END DESC,
        updated_at DESC,
        document_id
      LIMIT 12
    `);
    return rows.map((row) => ({
      documentId: row.document_id,
      name: row.name,
      path: row.path,
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  private scopeSql(query: SearchQuery): Prisma.Sql {
    if (query.scope === "all") return Prisma.sql`TRUE`;
    if (query.scope === "folder") {
      return Prisma.sql`document.folder_id = ${query.folderId}::uuid`;
    }
    return Prisma.sql`folder.ancestor_ids @> ARRAY[${query.folderId}::uuid]`;
  }
}

function searchRow(row: RawSearchRow): SearchProviderRow {
  return {
    documentId: row.document_id,
    name: row.name,
    path: row.path,
    markdown: row.markdown,
    score: row.score,
  };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
