CREATE TABLE IF NOT EXISTS knowledge_documents (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    source_type VARCHAR(50) NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    page_count INT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id SERIAL PRIMARY KEY,
    document_id INT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    page_number INT,
    chunk_index INT NOT NULL,
    heading TEXT,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunks_doc_page_chunk_idx
    ON knowledge_chunks (document_id, page_number, chunk_index);

CREATE INDEX IF NOT EXISTS knowledge_documents_source_type_idx
    ON knowledge_documents (source_type);

CREATE INDEX IF NOT EXISTS knowledge_chunks_document_id_idx
    ON knowledge_chunks (document_id);

CREATE INDEX IF NOT EXISTS knowledge_chunks_page_number_idx
    ON knowledge_chunks (page_number);

CREATE INDEX IF NOT EXISTS knowledge_chunks_content_tsv_idx
    ON knowledge_chunks
    USING gin (to_tsvector('english', coalesce(heading, '') || ' ' || content));
