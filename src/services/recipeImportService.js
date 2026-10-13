const db = require('./db');
const { createRecipe, updateRecipe } = require('./recipeCatalogService');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeStringArray(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => normalizeText(item)).filter(Boolean);
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).replace(',', '.').trim();
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeMealType(mealType, title = '', tags = []) {
  const raw = `${normalizeText(mealType)} ${normalizeText(title)} ${normalizeStringArray(tags).join(' ')}`.toLowerCase();

  if (/breakfast|завтрак|desayuno|petit[- ]déjeuner/.test(raw)) return 'breakfast';
  if (/lunch|обед|almuerzo|comida|déjeuner/.test(raw)) return 'lunch';
  if (/dinner|ужин|cena|souper|supper/.test(raw)) return 'dinner';

  if (/oat|omelet|pancake|waffle|toast|yogurt|granola|каш|омлет|запеканк|овсян|блин|панкейк/.test(raw)) {
    return 'breakfast';
  }

  if (/salad|sandwich|bowl|soup|wrap|pasta|chicken|fish|rice|quinoa|кур|рыб|суп|салат|паста|рис|киноа|индейк/.test(raw)) {
    return 'lunch';
  }

  return null;
}

function inferIngredientCategory(name) {
  const value = normalizeText(name).toLowerCase();
  if (!value) return null;
  if (/chicken|turkey|beef|fish|salmon|tuna|egg|кур|индейк|говяд|рыб|яйц/.test(value)) return 'protein';
  if (/rice|quinoa|oat|pasta|buckwheat|potato|bread|flour|рис|киноа|овс|паст|греч|картоф|хлеб|мук/.test(value)) return 'grains';
  if (/milk|yogurt|cheese|cottage|молок|йогурт|сыр|творог/.test(value)) return 'dairy';
  if (/berry|banana|apple|pear|orange|lemon|авокад|ягод|банан|яблок|груш|апельсин|лимон/.test(value)) return 'fruit';
  if (/broccoli|spinach|tomato|cucumber|pepper|carrot|onion|garlic|шпинат|помид|огур|перец|морков|лук|чеснок|брокколи/.test(value)) return 'vegetables';
  if (/oil|honey|sugar|salt|pepper|масло|мед|сахар|соль|перец/.test(value)) return 'seasoning';
  if (/nut|seed|орех|сем/.test(value)) return 'nuts';
  return null;
}

function normalizeIngredients(ingredients) {
  return (Array.isArray(ingredients) ? ingredients : [])
    .map((item) => {
      if (typeof item === 'string') {
        return {
          name: normalizeText(item),
          canonicalName: normalizeText(item).toLowerCase(),
          category: inferIngredientCategory(item),
          amount: null,
          unit: null
        };
      }

      const name = normalizeText(item.name || item.canonicalName);
      if (!name) return null;

      return {
        name,
        canonicalName: normalizeText(item.canonicalName || name).toLowerCase(),
        category: normalizeText(item.category || '') || inferIngredientCategory(name),
        amount: toNullableNumber(item.amount),
        unit: normalizeText(item.unit || '') || null,
        optional: Boolean(item.optional),
        note: normalizeText(item.note || '') || null
      };
    })
    .filter(Boolean);
}

function normalizeInstructions(value) {
  return (Array.isArray(value) ? value : [])
    .map((step) => normalizeText(step))
    .filter(Boolean);
}

function normalizeNutrition(nutrition = {}) {
  const normalized = {
    calories: toNullableNumber(nutrition.calories),
    protein: toNullableNumber(nutrition.protein),
    fat: toNullableNumber(nutrition.fat),
    carbs: toNullableNumber(nutrition.carbs),
    fiber: toNullableNumber(nutrition.fiber),
    portionWeight: toNullableNumber(nutrition.portionWeight)
  };

  // If calories are absent, derive them from macros. If the source numbers
  // disagree materially, keep the record reviewable instead of hiding it.
  const macroCalories = normalized.protein !== null && normalized.fat !== null && normalized.carbs !== null
    ? normalized.protein * 4 + normalized.fat * 9 + normalized.carbs * 4
    : null;
  if (normalized.calories === null && macroCalories !== null) {
    normalized.calories = Math.round(macroCalories);
  }
  normalized.macroCalories = macroCalories !== null ? Math.round(macroCalories) : null;
  normalized.needsNutritionReview = normalized.calories !== null && macroCalories !== null
    && Math.abs(normalized.calories - macroCalories) / Math.max(normalized.calories, 1) > 0.25;
  return normalized;
}

function buildEmbeddingKey(recipe) {
  if (normalizeText(recipe.embeddingKey)) return normalizeText(recipe.embeddingKey);
  const source = normalizeText(recipe.sourceType || 'imported');
  const sourceTitle = normalizeText(recipe.sourceTitle || 'unknown-source');
  return `${source}:${slugify(sourceTitle)}:${slugify(recipe.title)}`;
}

function normalizeImportedRecipe(recipe, defaults = {}) {
  const title = normalizeText(recipe.title);
  const normalizedNutrition = normalizeNutrition(recipe.nutrition || defaults.nutrition || {});
  const { macroCalories, needsNutritionReview, ...nutrition } = normalizedNutrition;
  const tags = Array.from(new Set([
    ...normalizeStringArray(defaults.tags),
    ...normalizeStringArray(recipe.tags),
    ...(needsNutritionReview ? ['nutrition-review'] : [])
  ]));

  const mealType = normalizeMealType(recipe.mealType || defaults.mealType, title, tags);
  if (!title || !mealType) return null;

  const instructions = normalizeInstructions(recipe.instructions);
  const ingredients = normalizeIngredients(recipe.ingredients);
  if (!instructions.length || !ingredients.length) return null;

  return {
    title,
    description: normalizeText(recipe.description || defaults.description || ''),
    instructions,
    servings: toNullableNumber(recipe.servings ?? defaults.servings),
    cookingTimeMinutes: toNullableNumber(recipe.cookingTimeMinutes ?? defaults.cookingTimeMinutes),
    difficulty: normalizeText(recipe.difficulty || defaults.difficulty || '') || null,
    cuisine: normalizeText(recipe.cuisine || defaults.cuisine || '') || null,
    mealType,
    sourceType: normalizeText(recipe.sourceType || defaults.sourceType || 'imported'),
    sourceTitle: normalizeText(recipe.sourceTitle || defaults.sourceTitle || '') || null,
    sourceUrl: normalizeText(recipe.sourceUrl || defaults.sourceUrl || '') || null,
    license: normalizeText(recipe.license || defaults.license || '') || null,
    embeddingKey: buildEmbeddingKey({
      ...defaults,
      ...recipe,
      title
    }),
    status: normalizeText(
      recipe.status || defaults.status || (needsNutritionReview ? 'review' : 'active')
    ),
    tags,
    nutrition,
    ingredients
  };
}

async function findExistingRecipeId(normalizedRecipe) {
  const byEmbedding = await db.query(
    'SELECT id FROM recipes WHERE embedding_key = $1 LIMIT 1',
    [normalizedRecipe.embeddingKey]
  );
  if (byEmbedding.rows[0]?.id) return byEmbedding.rows[0].id;

  const canMatchBySourceUrl = normalizedRecipe.sourceUrl
    && normalizedRecipe.sourceType
    && normalizedRecipe.sourceType !== 'pdf_book_recipe';

  if (canMatchBySourceUrl) {
    const byUrl = await db.query(
      'SELECT id FROM recipes WHERE source_url = $1 LIMIT 1',
      [normalizedRecipe.sourceUrl]
    );
    if (byUrl.rows[0]?.id) return byUrl.rows[0].id;
  }

  const byTitle = await db.query(
    `SELECT id
     FROM recipes
     WHERE lower(title) = lower($1)
       AND coalesce(source_title, '') = coalesce($2, '')
       AND coalesce(source_type, '') = coalesce($3, '')
     LIMIT 1`,
    [normalizedRecipe.title, normalizedRecipe.sourceTitle, normalizedRecipe.sourceType]
  );

  return byTitle.rows[0]?.id || null;
}

async function upsertImportedRecipe(recipe, defaults = {}) {
  const normalizedRecipe = normalizeImportedRecipe(recipe, defaults);
  if (!normalizedRecipe) return null;

  const existingId = await findExistingRecipeId(normalizedRecipe);
  if (existingId) {
    return updateRecipe(existingId, normalizedRecipe);
  }

  return createRecipe(normalizedRecipe);
}

async function importRecipeBatch(recipes, defaults = {}) {
  const saved = [];

  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    const next = await upsertImportedRecipe(recipe, defaults);
    if (next) saved.push(next);
  }

  return saved;
}

module.exports = {
  importRecipeBatch,
  normalizeImportedRecipe,
  normalizeMealType,
  slugify,
  upsertImportedRecipe
};
