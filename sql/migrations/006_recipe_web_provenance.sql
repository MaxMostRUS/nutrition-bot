ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS language VARCHAR(10),
    ADD COLUMN IF NOT EXISTS license_url TEXT,
    ADD COLUMN IF NOT EXISTS source_checked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_revision TEXT,
    ADD COLUMN IF NOT EXISTS normalized_source_url TEXT,
    ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS quality_report JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS recipes_normalized_source_url_idx
    ON recipes (normalized_source_url)
    WHERE normalized_source_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS recipes_content_hash_idx
    ON recipes (content_hash)
    WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS recipes_language_idx
    ON recipes (language);

CREATE INDEX IF NOT EXISTS recipes_source_checked_at_idx
    ON recipes (source_checked_at DESC);
