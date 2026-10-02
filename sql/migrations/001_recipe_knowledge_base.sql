CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingredients (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    canonical_name TEXT NOT NULL UNIQUE,
    category VARCHAR(100),
    allergens JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipes (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    instructions JSONB NOT NULL DEFAULT '[]'::jsonb,
    servings INT,
    cooking_time_minutes INT,
    difficulty VARCHAR(50),
    cuisine VARCHAR(100),
    meal_type VARCHAR(50) NOT NULL,
    source_type VARCHAR(50),
    source_title TEXT,
    source_url TEXT,
    license TEXT,
    search_text TEXT,
    embedding_key TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id SERIAL PRIMARY KEY,
    recipe_id INT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_id INT NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    amount NUMERIC(10,2),
    unit VARCHAR(30),
    optional BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT
);

CREATE TABLE IF NOT EXISTS recipe_nutrition (
    recipe_id INT PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
    calories INT,
    protein NUMERIC(10,2),
    fat NUMERIC(10,2),
    carbs NUMERIC(10,2),
    fiber NUMERIC(10,2),
    portion_weight NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS recipe_tags (
    id SERIAL PRIMARY KEY,
    recipe_id INT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    tag VARCHAR(100) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS recipe_tags_unique_idx
    ON recipe_tags (recipe_id, tag);

CREATE INDEX IF NOT EXISTS recipes_meal_type_idx
    ON recipes (meal_type);

CREATE INDEX IF NOT EXISTS recipes_cuisine_idx
    ON recipes (cuisine);

CREATE INDEX IF NOT EXISTS recipes_status_idx
    ON recipes (status);

CREATE INDEX IF NOT EXISTS recipe_ingredients_recipe_id_idx
    ON recipe_ingredients (recipe_id);

CREATE INDEX IF NOT EXISTS recipe_ingredients_ingredient_id_idx
    ON recipe_ingredients (ingredient_id);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS favorite_cuisines JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS disliked_ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS allergies JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS diet_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS budget_level VARCHAR(30),
    ADD COLUMN IF NOT EXISTS cooking_time_limit INT,
    ADD COLUMN IF NOT EXISTS equipment JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS meals_per_day INT DEFAULT 3;

CREATE TABLE IF NOT EXISTS user_recipe_feedback (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id INT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    liked BOOLEAN,
    rating INT,
    feedback_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_recipe_feedback_user_id_idx
    ON user_recipe_feedback (user_id);

CREATE INDEX IF NOT EXISTS user_recipe_feedback_recipe_id_idx
    ON user_recipe_feedback (recipe_id);
