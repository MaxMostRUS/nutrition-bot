const db = require('./db');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeChunks(chunks) {
  return Array.isArray(chunks) ? chunks.filter((chunk) => normalizeText(chunk.content)) : [];
}

async function upsertKnowledgeDocument({
  title,
  sourceType,
  filePath,
  pageCount,
  metadata = {}
}) {
  const result = await db.query(
    `INSERT INTO knowledge_documents (
       title, source_type, file_path, page_count, metadata, updated_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
     ON CONFLICT (file_path)
     DO UPDATE SET
       title = EXCLUDED.title,
       source_type = EXCLUDED.source_type,
       page_count = EXCLUDED.page_count,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING id, title, source_type, file_path, page_count, metadata, created_at, updated_at`,
    [
      normalizeText(title),
      normalizeText(sourceType),
      normalizeText(filePath),
      pageCount || null,
      JSON.stringify(metadata || {})
    ]
  );

  return result.rows[0];
}

async function replaceKnowledgeChunks(documentId, chunks) {
  const normalizedChunks = normalizeChunks(chunks);
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM knowledge_chunks WHERE document_id = $1', [documentId]);

    for (let index = 0; index < normalizedChunks.length; index++) {
      const chunk = normalizedChunks[index];
      await client.query(
        `INSERT INTO knowledge_chunks (
           document_id, page_number, chunk_index, heading, content, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          documentId,
          chunk.pageNumber || null,
          chunk.chunkIndex ?? index,
          normalizeText(chunk.heading || '') || null,
          normalizeText(chunk.content),
          JSON.stringify(chunk.metadata || {})
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ingestKnowledgeDocument(document, chunks) {
  const saved = await upsertKnowledgeDocument(document);
  await replaceKnowledgeChunks(saved.id, chunks);
  return saved;
}

async function searchKnowledge(query, options = {}) {
  const text = normalizeText(query);
  if (!text) return [];

  const limit = Math.max(1, Math.min(Number(options.limit) || 5, 20));
  const params = [text];
  const where = [];

  if (options.sourceType) {
    params.push(normalizeText(options.sourceType));
    where.push(`d.source_type = $${params.length}`);
  }

  const whereSql = where.length ? `AND ${where.join(' AND ')}` : '';

  params.push(limit);

  const querySql = `
    SELECT
      c.id,
      c.document_id,
      c.page_number,
      c.chunk_index,
      c.heading,
      c.content,
      c.metadata,
      d.title,
      d.file_path,
      d.source_type,
      ts_rank(
        to_tsvector('english', coalesce(c.heading, '') || ' ' || c.content),
        plainto_tsquery('english', $1)
      ) AS rank
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id
    WHERE
      to_tsvector('english', coalesce(c.heading, '') || ' ' || c.content)
      @@ plainto_tsquery('english', $1)
      ${whereSql}
    ORDER BY rank DESC, c.id ASC
    LIMIT $${params.length}
  `;

  let result = await db.query(querySql, params);

  if (result.rows.length === 0) {
    const fallbackParams = [`%${text}%`];
    const fallbackWhere = [];
    if (options.sourceType) {
      fallbackParams.push(normalizeText(options.sourceType));
      fallbackWhere.push(`d.source_type = $${fallbackParams.length}`);
    }
    fallbackParams.push(limit);

    const fallbackSql = `
      SELECT
        c.id,
        c.document_id,
        c.page_number,
        c.chunk_index,
        c.heading,
        c.content,
        c.metadata,
        d.title,
        d.file_path,
        d.source_type,
        0 AS rank
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE (
        c.content ILIKE $1
        OR coalesce(c.heading, '') ILIKE $1
        OR d.title ILIKE $1
      )
      ${fallbackWhere.length ? `AND ${fallbackWhere.join(' AND ')}` : ''}
      ORDER BY c.id ASC
      LIMIT $${fallbackParams.length}
    `;

    result = await db.query(fallbackSql, fallbackParams);
  }

  return result.rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    filePath: row.file_path,
    sourceType: row.source_type,
    pageNumber: row.page_number,
    chunkIndex: row.chunk_index,
    heading: row.heading,
    content: row.content,
    metadata: row.metadata || {},
    rank: Number(row.rank || 0)
  }));
}

function formatKnowledgeSnippets(snippets) {
  return snippets.map((item, index) => {
    const header = `[${index + 1}] ${item.title}${item.pageNumber ? `, page ${item.pageNumber}` : ''}`;
    return `${header}\n${item.content}`;
  }).join('\n\n');
}

module.exports = {
  formatKnowledgeSnippets,
  ingestKnowledgeDocument,
  searchKnowledge
};
