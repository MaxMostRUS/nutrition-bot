const db = require('./db');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeCanonicalName(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeStringArray(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeJsonArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function coerceNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  return number;
}

function buildSearchText(recipe) {
  const parts = [
    recipe.title,
    recipe.description,
    recipe.cuisine,
    recipe.mealType,
    ...normalizeStringArray(recipe.tags)
  ];
  return parts.filter(Boolean).join(' ').trim();
}

async function ensureIngredient(client, ingredient) {
  const name = normalizeText(ingredient.name || ingredient.canonicalName);
  if (!name) {
    throw new Error('Ingredient name is required');
  }

  const canonicalName = normalizeCanonicalName(ingredient.canonicalName || name);
  const category = normalizeText(ingredient.category || '') || null;
  const allergens = normalizeJsonArray(ingredient.allergens);

  const result = await client.query(
    `INSERT INTO ingredients (name, canonical_name, category, allergens)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (canonical_name)
     DO UPDATE SET
       name = EXCLUDED.name,
       category = COALESCE(EXCLUDED.category, ingredients.category),
       allergens = CASE
         WHEN EXCLUDED.allergens = '[]'::jsonb THEN ingredients.allergens
         ELSE EXCLUDED.allergens
       END
     RETURNING id, name, canonical_name, category, allergens`,
    [name, canonicalName, category, JSON.stringify(allergens)]
  );

  return result.rows[0];
}

function mapRecipeRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    instructions: Array.isArray(row.instructions) ? row.instructions : [],
    servings: row.servings,
    cookingTimeMinutes: row.cooking_time_minutes,
    difficulty: row.difficulty,
    cuisine: row.cuisine,
    mealType: row.meal_type,
    sourceType: row.source_type,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    license: row.license,
    searchText: row.search_text,
    embeddingKey: row.embedding_key,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nutrition: {
      calories: row.calories,
      protein: row.protein,
      fat: row.fat,
      carbs: row.carbs,
      fiber: row.fiber,
      portionWeight: row.portion_weight
    },
    tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : []
  };
}

async function fetchRecipeBase(client, recipeId) {
  const result = await client.query(
    `SELECT
       r.*,
       rn.calories,
       rn.protein,
       rn.fat,
       rn.carbs,
       rn.fiber,
       rn.portion_weight,
       COALESCE(
         json_agg(DISTINCT rt.tag) FILTER (WHERE rt.tag IS NOT NULL),
         '[]'::json
       ) AS tags
     FROM recipes r
     LEFT JOIN recipe_nutrition rn ON rn.recipe_id = r.id
     LEFT JOIN recipe_tags rt ON rt.recipe_id = r.id
     WHERE r.id = $1
     GROUP BY
       r.id,
       rn.calories,
       rn.protein,
       rn.fat,
       rn.carbs,
       rn.fiber,
       rn.portion_weight`,
    [recipeId]
  );

  if (result.rows.length === 0) return null;
  return mapRecipeRow(result.rows[0]);
}

async function fetchRecipeIngredients(client, recipeId) {
  const result = await client.query(
    `SELECT
       ri.amount,
       ri.unit,
       ri.optional,
       ri.note,
       i.id AS ingredient_id,
       i.name,
       i.canonical_name,
       i.category,
       i.allergens
     FROM recipe_ingredients ri
     JOIN ingredients i ON i.id = ri.ingredient_id
     WHERE ri.recipe_id = $1
     ORDER BY ri.id ASC`,
    [recipeId]
  );

  return result.rows.map((row) => ({
    ingredientId: row.ingredient_id,
    name: row.name,
    canonicalName: row.canonical_name,
    category: row.category,
    allergens: Array.isArray(row.allergens) ? row.allergens : [],
    amount: row.amount === null ? null : Number(row.amount),
    unit: row.unit,
    optional: row.optional,
    note: row.note
  }));
}

async function getRecipeById(recipeId) {
  const client = await db.pool.connect();
  try {
    const recipe = await fetchRecipeBase(client, recipeId);
    if (!recipe) return null;
    recipe.ingredients = await fetchRecipeIngredients(client, recipeId);
    return recipe;
  } finally {
    client.release();
  }
}

async function replaceRecipeIngredients(client, recipeId, ingredients) {
  await client.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [recipeId]);

  for (const item of normalizeJsonArray(ingredients)) {
    const ingredient = await ensureIngredient(client, item);
    await client.query(
      `INSERT INTO recipe_ingredients (
         recipe_id, ingredient_id, amount, unit, optional, note
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        recipeId,
        ingredient.id,
        coerceNullableNumber(item.amount),
        normalizeText(item.unit || '') || null,
        Boolean(item.optional),
        normalizeText(item.note || '') || null
      ]
    );
  }
}

async function replaceRecipeTags(client, recipeId, tags) {
  await client.query('DELETE FROM recipe_tags WHERE recipe_id = $1', [recipeId]);

  for (const tag of normalizeStringArray(tags)) {
    await client.query(
      'INSERT INTO recipe_tags (recipe_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [recipeId, tag]
    );
  }
}

async function replaceRecipeNutrition(client, recipeId, nutrition) {
  if (!nutrition) {
    await client.query('DELETE FROM recipe_nutrition WHERE recipe_id = $1', [recipeId]);
    return;
  }

  await client.query(
    `INSERT INTO recipe_nutrition (
       recipe_id, calories, protein, fat, carbs, fiber, portion_weight
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (recipe_id)
     DO UPDATE SET
       calories = EXCLUDED.calories,
       protein = EXCLUDED.protein,
       fat = EXCLUDED.fat,
       carbs = EXCLUDED.carbs,
       fiber = EXCLUDED.fiber,
       portion_weight = EXCLUDED.portion_weight`,
    [
      recipeId,
      coerceNullableNumber(nutrition.calories),
      coerceNullableNumber(nutrition.protein),
      coerceNullableNumber(nutrition.fat),
      coerceNullableNumber(nutrition.carbs),
      coerceNullableNumber(nutrition.fiber),
      coerceNullableNumber(nutrition.portionWeight)
    ]
  );
}

async function createRecipe(recipe) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const payload = {
      title: normalizeText(recipe.title),
      description: normalizeText(recipe.description || ''),
      instructions: normalizeJsonArray(recipe.instructions),
      servings: coerceNullableNumber(recipe.servings),
      cookingTimeMinutes: coerceNullableNumber(recipe.cookingTimeMinutes),
      difficulty: normalizeText(recipe.difficulty || '') || null,
      cuisine: normalizeText(recipe.cuisine || '') || null,
      mealType: normalizeText(recipe.mealType),
      sourceType: normalizeText(recipe.sourceType || '') || null,
      sourceTitle: normalizeText(recipe.sourceTitle || '') || null,
      sourceUrl: normalizeText(recipe.sourceUrl || '') || null,
      license: normalizeText(recipe.license || '') || null,
      embeddingKey: normalizeText(recipe.embeddingKey || '') || null,
      status: normalizeText(recipe.status || 'draft'),
      tags: normalizeStringArray(recipe.tags),
      nutrition: recipe.nutrition || null,
      ingredients: normalizeJsonArray(recipe.ingredients)
    };

    if (!payload.title) throw new Error('Recipe title is required');
    if (!payload.mealType) throw new Error('Recipe mealType is required');

    const insertResult = await client.query(
      `INSERT INTO recipes (
         title, description, instructions, servings, cooking_time_minutes,
         difficulty, cuisine, meal_type, source_type, source_title,
         source_url, license, search_text, embedding_key, status
       )
       VALUES (
         $1, $2, $3::jsonb, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15
       )
       RETURNING id`,
      [
        payload.title,
        payload.description || null,
        JSON.stringify(payload.instructions),
        payload.servings,
        payload.cookingTimeMinutes,
        payload.difficulty,
        payload.cuisine,
        payload.mealType,
        payload.sourceType,
        payload.sourceTitle,
        payload.sourceUrl,
        payload.license,
        buildSearchText(payload),
        payload.embeddingKey,
        payload.status
      ]
    );

    const recipeId = insertResult.rows[0].id;

    await replaceRecipeIngredients(client, recipeId, payload.ingredients);
    await replaceRecipeTags(client, recipeId, payload.tags);
    await replaceRecipeNutrition(client, recipeId, payload.nutrition);

    await client.query('COMMIT');
    return await getRecipeById(recipeId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateRecipe(recipeId, changes) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const current = await fetchRecipeBase(client, recipeId);
    if (!current) {
      throw new Error(`Recipe not found: ${recipeId}`);
    }

    const next = {
      title: changes.title !== undefined ? normalizeText(changes.title) : current.title,
      description: changes.description !== undefined ? normalizeText(changes.description) : (current.description || ''),
      instructions: changes.instructions !== undefined ? normalizeJsonArray(changes.instructions) : current.instructions,
      servings: changes.servings !== undefined ? coerceNullableNumber(changes.servings) : current.servings,
      cookingTimeMinutes: changes.cookingTimeMinutes !== undefined ? coerceNullableNumber(changes.cookingTimeMinutes) : current.cookingTimeMinutes,
      difficulty: changes.difficulty !== undefined ? (normalizeText(changes.difficulty) || null) : current.difficulty,
      cuisine: changes.cuisine !== undefined ? (normalizeText(changes.cuisine) || null) : current.cuisine,
      mealType: changes.mealType !== undefined ? normalizeText(changes.mealType) : current.mealType,
      sourceType: changes.sourceType !== undefined ? (normalizeText(changes.sourceType) || null) : current.sourceType,
      sourceTitle: changes.sourceTitle !== undefined ? (normalizeText(changes.sourceTitle) || null) : current.sourceTitle,
      sourceUrl: changes.sourceUrl !== undefined ? (normalizeText(changes.sourceUrl) || null) : current.sourceUrl,
      license: changes.license !== undefined ? (normalizeText(changes.license) || null) : current.license,
      embeddingKey: changes.embeddingKey !== undefined ? (normalizeText(changes.embeddingKey) || null) : current.embeddingKey,
      status: changes.status !== undefined ? normalizeText(changes.status) : current.status,
      tags: changes.tags !== undefined ? normalizeStringArray(changes.tags) : current.tags
    };

    if (!next.title) throw new Error('Recipe title is required');
    if (!next.mealType) throw new Error('Recipe mealType is required');

    await client.query(
      `UPDATE recipes
       SET
         title = $2,
         description = $3,
         instructions = $4::jsonb,
         servings = $5,
         cooking_time_minutes = $6,
         difficulty = $7,
         cuisine = $8,
         meal_type = $9,
         source_type = $10,
         source_title = $11,
         source_url = $12,
         license = $13,
         search_text = $14,
         embedding_key = $15,
         status = $16,
         updated_at = NOW()
       WHERE id = $1`,
      [
        recipeId,
        next.title,
        next.description || null,
        JSON.stringify(next.instructions),
        next.servings,
        next.cookingTimeMinutes,
        next.difficulty,
        next.cuisine,
        next.mealType,
        next.sourceType,
        next.sourceTitle,
        next.sourceUrl,
        next.license,
        buildSearchText(next),
        next.embeddingKey,
        next.status
      ]
    );

    if (changes.ingredients !== undefined) {
      await replaceRecipeIngredients(client, recipeId, changes.ingredients);
    }

    if (changes.tags !== undefined) {
      await replaceRecipeTags(client, recipeId, next.tags);
    }

    if (changes.nutrition !== undefined) {
      await replaceRecipeNutrition(client, recipeId, changes.nutrition);
    }

    await client.query('COMMIT');
    return await getRecipeById(recipeId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function buildRecipeSearchWhere(filters, params) {
  const where = [];

  if (filters.status) {
    const statuses = normalizeStringArray(filters.status);
    if (statuses.length === 1) {
      params.push(statuses[0]);
      where.push(`r.status = $${params.length}`);
    } else if (statuses.length > 1) {
      params.push(statuses);
      where.push(`r.status = ANY($${params.length})`);
    }
  }

  if (filters.mealType) {
    const mealTypes = normalizeStringArray(filters.mealType);
    if (mealTypes.length === 1) {
      params.push(mealTypes[0]);
      where.push(`r.meal_type = $${params.length}`);
    } else if (mealTypes.length > 1) {
      params.push(mealTypes);
      where.push(`r.meal_type = ANY($${params.length})`);
    }
  }

  if (filters.cuisine) {
    const cuisines = normalizeStringArray(filters.cuisine);
    if (cuisines.length === 1) {
      params.push(cuisines[0]);
      where.push(`r.cuisine = $${params.length}`);
    } else if (cuisines.length > 1) {
      params.push(cuisines);
      where.push(`r.cuisine = ANY($${params.length})`);
    }
  }

  if (filters.sourceType) {
    const sourceTypes = normalizeStringArray(filters.sourceType);
    if (sourceTypes.length === 1) {
      params.push(sourceTypes[0]);
      where.push(`r.source_type = $${params.length}`);
    } else if (sourceTypes.length > 1) {
      params.push(sourceTypes);
      where.push(`r.source_type = ANY($${params.length})`);
    }
  }

  if (filters.searchText) {
    params.push(`%${normalizeText(filters.searchText)}%`);
    where.push(`(r.title ILIKE $${params.length} OR r.description ILIKE $${params.length} OR r.search_text ILIKE $${params.length})`);
  }

  if (filters.maxCookingTimeMinutes !== undefined) {
    params.push(coerceNullableNumber(filters.maxCookingTimeMinutes));
    where.push(`r.cooking_time_minutes <= $${params.length}`);
  }

  if (filters.excludeRecipeIds) {
    const ids = normalizeJsonArray(filters.excludeRecipeIds).map((id) => Number(id)).filter(Number.isFinite);
    if (ids.length > 0) {
      params.push(ids);
      where.push(`NOT (r.id = ANY($${params.length}))`);
    }
  }

  if (filters.tags) {
    const tags = normalizeStringArray(filters.tags);
    if (tags.length > 0) {
      params.push(tags);
      where.push(`EXISTS (
        SELECT 1 FROM recipe_tags rt2
        WHERE rt2.recipe_id = r.id
          AND rt2.tag = ANY($${params.length})
      )`);
    }
  }

  if (filters.dislikedIngredients) {
    const disliked = normalizeStringArray(filters.dislikedIngredients).map(normalizeCanonicalName);
    if (disliked.length > 0) {
      params.push(disliked);
      where.push(`NOT EXISTS (
        SELECT 1
        FROM recipe_ingredients ri2
        JOIN ingredients i2 ON i2.id = ri2.ingredient_id
        WHERE ri2.recipe_id = r.id
          AND i2.canonical_name = ANY($${params.length})
      )`);
    }
  }

  if (filters.allergies) {
    const allergies = normalizeStringArray(filters.allergies).map(normalizeText);
    if (allergies.length > 0) {
      params.push(JSON.stringify(allergies));
      where.push(`NOT EXISTS (
        SELECT 1
        FROM recipe_ingredients ri3
        JOIN ingredients i3 ON i3.id = ri3.ingredient_id
        WHERE ri3.recipe_id = r.id
          AND i3.allergens ?| ARRAY(SELECT jsonb_array_elements_text($${params.length}::jsonb))
      )`);
    }
  }

  if (filters.maxCalories !== undefined) {
    params.push(coerceNullableNumber(filters.maxCalories));
    where.push(`rn.calories <= $${params.length}`);
  }

  if (filters.minCalories !== undefined) {
    params.push(coerceNullableNumber(filters.minCalories));
    where.push(`rn.calories >= $${params.length}`);
  }

  if (filters.minProtein !== undefined) {
    params.push(coerceNullableNumber(filters.minProtein));
    where.push(`rn.protein >= $${params.length}`);
  }

  if (filters.maxCarbs !== undefined) {
    params.push(coerceNullableNumber(filters.maxCarbs));
    where.push(`rn.carbs <= $${params.length}`);
  }

  return where;
}

function scoreRecipeCandidate(recipe, targets) {
  let score = 0;
  const nutrition = recipe.nutrition || {};

  if (targets.targetCalories !== undefined && nutrition.calories !== null && nutrition.calories !== undefined) {
    score += Math.abs(Number(nutrition.calories) - Number(targets.targetCalories));
  }

  if (targets.targetProtein !== undefined && nutrition.protein !== null && nutrition.protein !== undefined) {
    score += Math.abs(Number(nutrition.protein) - Number(targets.targetProtein)) * 2;
  }

  if (targets.targetFat !== undefined && nutrition.fat !== null && nutrition.fat !== undefined) {
    score += Math.abs(Number(nutrition.fat) - Number(targets.targetFat)) * 1.5;
  }

  if (targets.targetCarbs !== undefined && nutrition.carbs !== null && nutrition.carbs !== undefined) {
    score += Math.abs(Number(nutrition.carbs) - Number(targets.targetCarbs)) * 1.5;
  }

  return score;
}

async function searchRecipes(filters = {}) {
  const params = [];
  const where = buildRecipeSearchWhere(filters, params);
  const limit = Math.max(1, Math.min(Number(filters.limit) || 20, 100));

  params.push(limit);

  const query = `
    SELECT
      r.*,
      rn.calories,
      rn.protein,
      rn.fat,
      rn.carbs,
      rn.fiber,
      rn.portion_weight,
      COALESCE(
        json_agg(DISTINCT rt.tag) FILTER (WHERE rt.tag IS NOT NULL),
        '[]'::json
      ) AS tags
    FROM recipes r
    LEFT JOIN recipe_nutrition rn ON rn.recipe_id = r.id
    LEFT JOIN recipe_tags rt ON rt.recipe_id = r.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY
      r.id,
      rn.calories,
      rn.protein,
      rn.fat,
      rn.carbs,
      rn.fiber,
      rn.portion_weight
    ORDER BY r.updated_at DESC, r.id DESC
    LIMIT $${params.length}
  `;

  const result = await db.query(query, params);
  return result.rows.map(mapRecipeRow);
}

async function listRecipeCandidates(filters = {}) {
  const recipes = await searchRecipes({
    ...filters,
    limit: filters.limit || 50,
    status: filters.status || 'active'
  });

  return recipes
    .map((recipe) => ({
      ...recipe,
      score: scoreRecipeCandidate(recipe, filters)
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.max(1, Math.min(Number(filters.top) || 20, 50)));
}

module.exports = {
  createRecipe,
  getRecipeById,
  listRecipeCandidates,
  searchRecipes,
  updateRecipe
};
