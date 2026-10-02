const db = require('./db');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeStringArray(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  return number;
}

function mapUserPreferenceRow(row) {
  if (!row) return null;
  return {
    userId: row.id,
    telegramId: row.telegram_id,
    favoriteCuisines: Array.isArray(row.favorite_cuisines) ? row.favorite_cuisines : [],
    dislikedIngredients: Array.isArray(row.disliked_ingredients) ? row.disliked_ingredients : [],
    allergies: Array.isArray(row.allergies) ? row.allergies : [],
    dietType: row.diet_type,
    budgetLevel: row.budget_level,
    cookingTimeLimit: row.cooking_time_limit,
    equipment: Array.isArray(row.equipment) ? row.equipment : [],
    mealsPerDay: row.meals_per_day
  };
}

async function getUserRowById(userId) {
  const result = await db.query(
    `SELECT
       id,
       telegram_id,
       favorite_cuisines,
       disliked_ingredients,
       allergies,
       diet_type,
       budget_level,
       cooking_time_limit,
       equipment,
       meals_per_day
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return result.rows[0] || null;
}

async function getUserRowByTelegramId(telegramId) {
  const result = await db.query(
    `SELECT
       id,
       telegram_id,
       favorite_cuisines,
       disliked_ingredients,
       allergies,
       diet_type,
       budget_level,
       cooking_time_limit,
       equipment,
       meals_per_day
     FROM users
     WHERE telegram_id = $1`,
    [telegramId]
  );

  return result.rows[0] || null;
}

async function getUserPreferences(userId) {
  const row = await getUserRowById(userId);
  return mapUserPreferenceRow(row);
}

async function getUserPreferencesByTelegramId(telegramId) {
  const row = await getUserRowByTelegramId(telegramId);
  return mapUserPreferenceRow(row);
}

async function updateUserPreferencesByUserId(userId, preferences = {}) {
  const current = await getUserRowById(userId);
  if (!current) {
    throw new Error(`User not found: ${userId}`);
  }

  const next = {
    favoriteCuisines: preferences.favoriteCuisines !== undefined
      ? normalizeStringArray(preferences.favoriteCuisines)
      : (Array.isArray(current.favorite_cuisines) ? current.favorite_cuisines : []),
    dislikedIngredients: preferences.dislikedIngredients !== undefined
      ? normalizeStringArray(preferences.dislikedIngredients)
      : (Array.isArray(current.disliked_ingredients) ? current.disliked_ingredients : []),
    allergies: preferences.allergies !== undefined
      ? normalizeStringArray(preferences.allergies)
      : (Array.isArray(current.allergies) ? current.allergies : []),
    dietType: preferences.dietType !== undefined
      ? (normalizeText(preferences.dietType) || null)
      : current.diet_type,
    budgetLevel: preferences.budgetLevel !== undefined
      ? (normalizeText(preferences.budgetLevel) || null)
      : current.budget_level,
    cookingTimeLimit: preferences.cookingTimeLimit !== undefined
      ? normalizeNullableNumber(preferences.cookingTimeLimit)
      : current.cooking_time_limit,
    equipment: preferences.equipment !== undefined
      ? normalizeStringArray(preferences.equipment)
      : (Array.isArray(current.equipment) ? current.equipment : []),
    mealsPerDay: preferences.mealsPerDay !== undefined
      ? normalizeNullableNumber(preferences.mealsPerDay)
      : current.meals_per_day
  };

  const result = await db.query(
    `UPDATE users
     SET
       favorite_cuisines = $2::jsonb,
       disliked_ingredients = $3::jsonb,
       allergies = $4::jsonb,
       diet_type = $5,
       budget_level = $6,
       cooking_time_limit = $7,
       equipment = $8::jsonb,
       meals_per_day = $9
     WHERE id = $1
     RETURNING
       id,
       telegram_id,
       favorite_cuisines,
       disliked_ingredients,
       allergies,
       diet_type,
       budget_level,
       cooking_time_limit,
       equipment,
       meals_per_day`,
    [
      userId,
      JSON.stringify(next.favoriteCuisines),
      JSON.stringify(next.dislikedIngredients),
      JSON.stringify(next.allergies),
      next.dietType,
      next.budgetLevel,
      next.cookingTimeLimit,
      JSON.stringify(next.equipment),
      next.mealsPerDay
    ]
  );

  return mapUserPreferenceRow(result.rows[0]);
}

async function updateUserPreferencesByTelegramId(telegramId, preferences = {}) {
  const row = await getUserRowByTelegramId(telegramId);
  if (!row) {
    throw new Error(`User not found for telegram_id=${telegramId}`);
  }

  return updateUserPreferencesByUserId(row.id, preferences);
}

async function recordRecipeFeedback({ userId, recipeId, liked, rating, feedbackReason }) {
  if (!userId) throw new Error('userId is required');
  if (!recipeId) throw new Error('recipeId is required');

  const normalizedRating = rating === undefined || rating === null || rating === ''
    ? null
    : Number(rating);

  if (normalizedRating !== null && (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5)) {
    throw new Error('rating must be an integer from 1 to 5');
  }

  const result = await db.query(
    `INSERT INTO user_recipe_feedback (
       user_id, recipe_id, liked, rating, feedback_reason
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, recipe_id, liked, rating, feedback_reason, created_at`,
    [
      userId,
      recipeId,
      liked === undefined ? null : Boolean(liked),
      normalizedRating,
      normalizeText(feedbackReason || '') || null
    ]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    recipeId: row.recipe_id,
    liked: row.liked,
    rating: row.rating,
    feedbackReason: row.feedback_reason,
    createdAt: row.created_at
  };
}

async function listUserRecipeFeedback(userId, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 50, 200));
  const result = await db.query(
    `SELECT
       f.id,
       f.user_id,
       f.recipe_id,
       f.liked,
       f.rating,
       f.feedback_reason,
       f.created_at,
       r.title AS recipe_title
     FROM user_recipe_feedback f
     JOIN recipes r ON r.id = f.recipe_id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    recipeId: row.recipe_id,
    recipeTitle: row.recipe_title,
    liked: row.liked,
    rating: row.rating,
    feedbackReason: row.feedback_reason,
    createdAt: row.created_at
  }));
}

async function getPlannerPreferenceProfile(userId) {
  const preferences = await getUserPreferences(userId);
  if (!preferences) return null;

  const feedback = await listUserRecipeFeedback(userId, { limit: 100 });
  const likedRecipeIds = [];
  const blockedRecipeIds = [];

  for (const item of feedback) {
    if (item.liked === true) likedRecipeIds.push(item.recipeId);
    if (item.liked === false) blockedRecipeIds.push(item.recipeId);
  }

  return {
    ...preferences,
    likedRecipeIds,
    blockedRecipeIds
  };
}

module.exports = {
  getPlannerPreferenceProfile,
  getUserPreferences,
  getUserPreferencesByTelegramId,
  listUserRecipeFeedback,
  recordRecipeFeedback,
  updateUserPreferencesByTelegramId,
  updateUserPreferencesByUserId
};
