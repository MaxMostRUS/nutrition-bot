ALTER TABLE meals
    ADD COLUMN IF NOT EXISTS recipe_id INT REFERENCES recipes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS meals_recipe_id_idx
    ON meals (recipe_id);
