const db = require('../services/db');

function pickKeeper(rows) {
  return [...rows].sort((left, right) => {
    const leftUpdated = new Date(left.updated_at || 0).getTime();
    const rightUpdated = new Date(right.updated_at || 0).getTime();
    if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;
    return left.id - right.id;
  })[0];
}

async function moveFeedback(client, fromRecipeId, toRecipeId) {
  await client.query(
    `UPDATE user_recipe_feedback
     SET recipe_id = $2
     WHERE recipe_id = $1`,
    [fromRecipeId, toRecipeId]
  );
}

async function copyTags(client, fromRecipeId, toRecipeId) {
  await client.query(
    `INSERT INTO recipe_tags (recipe_id, tag)
     SELECT $2, tag
     FROM recipe_tags
     WHERE recipe_id = $1
     ON CONFLICT DO NOTHING`,
    [fromRecipeId, toRecipeId]
  );
}

async function copyIngredients(client, fromRecipeId, toRecipeId) {
  const rows = await client.query(
    `SELECT ingredient_id, amount, unit, optional, note
     FROM recipe_ingredients
     WHERE recipe_id = $1`,
    [fromRecipeId]
  );

  for (const row of rows.rows) {
    const exists = await client.query(
      `SELECT 1
       FROM recipe_ingredients
       WHERE recipe_id = $1
         AND ingredient_id = $2
         AND amount IS NOT DISTINCT FROM $3
         AND unit IS NOT DISTINCT FROM $4
         AND optional = $5
         AND note IS NOT DISTINCT FROM $6
       LIMIT 1`,
      [toRecipeId, row.ingredient_id, row.amount, row.unit, row.optional, row.note]
    );

    if (exists.rows[0]) continue;

    await client.query(
      `INSERT INTO recipe_ingredients (
         recipe_id, ingredient_id, amount, unit, optional, note
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [toRecipeId, row.ingredient_id, row.amount, row.unit, row.optional, row.note]
    );
  }
}

async function copyNutrition(client, fromRecipeId, toRecipeId) {
  const target = await client.query(
    `SELECT recipe_id, calories, protein, fat, carbs, fiber, portion_weight
     FROM recipe_nutrition
     WHERE recipe_id = $1`,
    [toRecipeId]
  );

  if (target.rows[0]) return;

  await client.query(
    `INSERT INTO recipe_nutrition (
       recipe_id, calories, protein, fat, carbs, fiber, portion_weight
     )
     SELECT $2, calories, protein, fat, carbs, fiber, portion_weight
     FROM recipe_nutrition
     WHERE recipe_id = $1
     ON CONFLICT (recipe_id) DO NOTHING`,
    [fromRecipeId, toRecipeId]
  );
}

async function deleteRecipe(client, recipeId) {
  await client.query('DELETE FROM recipes WHERE id = $1', [recipeId]);
}

async function mergeDuplicateGroup(client, rows) {
  if (rows.length < 2) return null;

  const keeper = pickKeeper(rows);
  const duplicates = rows.filter((row) => row.id !== keeper.id);

  for (const duplicate of duplicates) {
    await moveFeedback(client, duplicate.id, keeper.id);
    await copyTags(client, duplicate.id, keeper.id);
    await copyIngredients(client, duplicate.id, keeper.id);
    await copyNutrition(client, duplicate.id, keeper.id);
    await deleteRecipe(client, duplicate.id);
  }

  return {
    keeperId: keeper.id,
    removedIds: duplicates.map((row) => row.id),
    title: keeper.title,
    sourceType: keeper.source_type,
    sourceUrl: keeper.source_url
  };
}

async function findDuplicateGroups(client) {
  const groups = [];

  const embeddingGroups = await client.query(
    `SELECT embedding_key
     FROM recipes
     WHERE embedding_key IS NOT NULL
       AND embedding_key <> ''
     GROUP BY embedding_key
     HAVING COUNT(*) > 1
     ORDER BY embedding_key`
  );

  for (const key of embeddingGroups.rows) {
    const rows = await client.query(
      `SELECT id, title, source_type, source_url, updated_at
       FROM recipes
       WHERE embedding_key = $1
       ORDER BY id`,
      [key.embedding_key]
    );
    groups.push(rows.rows);
  }

  const titleGroups = await client.query(
    `SELECT source_type, source_url, lower(title) AS normalized_title
     FROM recipes
     WHERE coalesce(embedding_key, '') = ''
       AND source_url IS NOT NULL
       AND source_url <> ''
     GROUP BY source_type, source_url, lower(title)
     HAVING COUNT(*) > 1
     ORDER BY source_type, source_url, lower(title)`
  );

  for (const key of titleGroups.rows) {
    const rows = await client.query(
      `SELECT id, title, source_type, source_url, updated_at
       FROM recipes
       WHERE source_type = $1
         AND source_url = $2
         AND lower(title) = $3
       ORDER BY id`,
      [key.source_type, key.source_url, key.normalized_title]
    );
    groups.push(rows.rows);
  }

  return groups;
}

async function main() {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const groups = await findDuplicateGroups(client);
    const merged = [];

    for (const group of groups) {
      const result = await mergeDuplicateGroup(client, group);
      if (result) merged.push(result);
    }

    await client.query('COMMIT');

    console.log(JSON.stringify({
      groupsFound: groups.length,
      groupsMerged: merged.length,
      merged
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Recipe dedupe failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
