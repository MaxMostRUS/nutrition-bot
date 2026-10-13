const { getRecipeById, listRecipeCandidates } = require('./recipeCatalogService');
const { getPlannerPreferenceProfile } = require('./userPreferenceService');
const { PLANNER_MODE } = require('../config');

const DEFAULT_MEAL_DISTRIBUTION = {
  breakfast: 0.25,
  lunch: 0.4,
  dinner: 0.35
};

const IMPORTED_SOURCE_TYPES = [
  'pdf_book_recipe',
  'web_medlineplus',
  'web_medlineplus_es',
  'open_dataset_unitools'
];
const SEED_SOURCE_TYPES = ['seed'];

function uniqueNumbers(values) {
  return Array.from(new Set(values.filter(Number.isFinite)));
}

function buildRecipePayload(recipe) {
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map((item) => {
        const amount = item.amount === null || item.amount === undefined ? '' : `${item.amount}`;
        const unit = item.unit ? ` ${item.unit}` : '';
        const note = item.note ? ` (${item.note})` : '';
        return `${amount}${unit} ${item.name}`.trim() + note;
      })
    : [];

  return {
    ingredients,
    steps: Array.isArray(recipe.instructions) ? recipe.instructions : [],
    cookingTimeMinutes: recipe.cookingTimeMinutes || 0
  };
}

function scaleRecipePayload(recipe, scaleFactor) {
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map((item) => {
        if (item.amount === null || item.amount === undefined || Number.isNaN(Number(item.amount))) {
          return item.name;
        }

        const scaledAmount = Math.round(Number(item.amount) * scaleFactor * 10) / 10;
        const unit = item.unit ? ` ${item.unit}` : '';
        const note = item.note ? ` (${item.note})` : '';
        return `${scaledAmount}${unit} ${item.name}`.trim() + note;
      })
    : [];

  return {
    ingredients,
    steps: Array.isArray(recipe.instructions) ? recipe.instructions : [],
    cookingTimeMinutes: recipe.cookingTimeMinutes || 0
  };
}

function scoreDiversityPenalty(recipe, context) {
  let penalty = 0;
  const cuisineCount = context.cuisineCounts.get(recipe.cuisine || '') || 0;
  const titleCount = context.titleCounts.get(recipe.title || '') || 0;

  penalty += titleCount * 100;
  penalty += cuisineCount * 10;

  if (context.lastBreakfastTitle && recipe.mealType === 'breakfast' && context.lastBreakfastTitle === recipe.title) {
    penalty += 60;
  }

  return penalty;
}

function updateSelectionContext(context, recipe, mealTime) {
  context.usedRecipeIds.add(recipe.id);
  context.titleCounts.set(recipe.title || '', (context.titleCounts.get(recipe.title || '') || 0) + 1);

  if (recipe.cuisine) {
    context.cuisineCounts.set(recipe.cuisine, (context.cuisineCounts.get(recipe.cuisine) || 0) + 1);
  }

  if (mealTime === 'breakfast') {
    context.lastBreakfastTitle = recipe.title || null;
  }
}

function buildCandidateFilter(profile, mealTime, targets, excludedRecipeIds) {
  const cookingTimeGrace = mealTime === 'breakfast' ? 15 : 30;
  const filter = {
    status: 'active',
    mealType: mealTime,
    limit: 25,
    top: 10,
    excludeRecipeIds: excludedRecipeIds,
    maxCookingTimeMinutes: profile?.cookingTimeLimit
      ? profile.cookingTimeLimit + cookingTimeGrace
      : undefined,
    dislikedIngredients: profile?.dislikedIngredients || [],
    allergies: profile?.allergies || [],
    targetCalories: targets.calories,
    targetProtein: targets.protein,
    targetFat: targets.fat,
    targetCarbs: targets.carbs,
    minCalories: Math.max(80, Math.round(targets.calories * 0.12)),
    maxCalories: Math.round(targets.calories * 4.5)
  };

  if (targets.protein > 0) {
    filter.minProtein = Math.max(0, Math.round(targets.protein * 0.12));
  }

  if (targets.carbs > 0) {
    filter.maxCarbs = Math.round(targets.carbs * 4.5);
  }

  return filter;
}

async function chooseRecipeForMeal(profile, mealTime, targets, context) {
  const excludedRecipeIds = uniqueNumbers([
    ...Array.from(context.usedRecipeIds),
    ...(Array.isArray(profile?.blockedRecipeIds) ? profile.blockedRecipeIds : [])
  ]);

  const baseFilter = buildCandidateFilter(profile, mealTime, targets, excludedRecipeIds);
  const favoriteCuisines = Array.isArray(profile?.favoriteCuisines) ? profile.favoriteCuisines : [];
  const allowSeedFallback = PLANNER_MODE !== 'imported_only';

  async function findCandidatesForSourceTypes(sourceTypes) {
    if (favoriteCuisines.length > 0) {
      const preferred = await listRecipeCandidates({
        ...baseFilter,
        cuisine: favoriteCuisines,
        sourceType: sourceTypes
      });
      if (preferred.length > 0) return preferred;
    }

    return listRecipeCandidates({
      ...baseFilter,
      sourceType: sourceTypes
    });
  }

  let candidates = await findCandidatesForSourceTypes(IMPORTED_SOURCE_TYPES);

  if (!candidates.length && allowSeedFallback) {
    candidates = await findCandidatesForSourceTypes(SEED_SOURCE_TYPES);
  }

  if (!candidates.length) {
    const fallbackFilter = allowSeedFallback
      ? baseFilter
      : { ...baseFilter, sourceType: IMPORTED_SOURCE_TYPES };

    if (favoriteCuisines.length > 0) {
      candidates = await listRecipeCandidates({
        ...fallbackFilter,
        cuisine: favoriteCuisines
      });
    }
  }

  if (!candidates.length) {
    const fallbackFilter = allowSeedFallback
      ? baseFilter
      : { ...baseFilter, sourceType: IMPORTED_SOURCE_TYPES };
    candidates = await listRecipeCandidates(fallbackFilter);
  }

  if (!candidates.length) {
    return null;
  }

  const best = candidates
    .map((candidate) => ({
      candidate,
      totalScore: candidate.score + scoreDiversityPenalty(candidate, context)
    }))
    .sort((a, b) => a.totalScore - b.totalScore)[0]?.candidate;

  if (!best) return null;
  return getRecipeById(best.id);
}

function buildMealTargets(dailyCalories, protein, fat, carbs, mealTime) {
  const ratio = DEFAULT_MEAL_DISTRIBUTION[mealTime];
  return {
    calories: Math.round(dailyCalories * ratio),
    protein: Math.round(protein * ratio),
    fat: Math.round(fat * ratio),
    carbs: Math.round(carbs * ratio)
  };
}

function convertRecipeToMeal(dayNumber, mealTime, recipe, targets) {
  const nutrition = recipe.nutrition || {};
  const baseCalories = Number(nutrition.calories || 0);
  const rawScaleFactor = baseCalories > 0 ? Number(targets.calories || 0) / baseCalories : 1;
  const scaleFactor = Math.max(0.25, Math.min(rawScaleFactor || 1, 4));

  function scale(value) {
    if (value === null || value === undefined) return 0;
    return Math.round(Number(value) * scaleFactor);
  }

  const scaledNutrition = {
    calories: scale(nutrition.calories),
    protein: scale(nutrition.protein),
    fat: scale(nutrition.fat),
    carbs: scale(nutrition.carbs),
    fiber: scale(nutrition.fiber),
    portionWeight: scale(nutrition.portionWeight)
  };
  const scaledPayload = scaleRecipePayload(recipe, scaleFactor);

  // Keep the displayed recipe on the same serving basis as the meal macros.
  // LLM adaptation is intentionally not used here: it can change ingredients
  // without changing the nutrition fields, producing the mismatch users saw.
  const storedRecipe = {
    title: recipe.title,
    baseRecipeId: recipe.id,
    baseRecipeTitle: recipe.title,
    sourceTitle: recipe.sourceTitle,
    sourceType: recipe.sourceType,
    sourceUrl: recipe.sourceUrl,
    ingredients: scaledPayload.ingredients,
    steps: scaledPayload.steps,
    cookingTimeMinutes: scaledPayload.cookingTimeMinutes,
    nutrition: scaledNutrition,
    estimatedNutrition: true,
    servingScale: scaleFactor
  };

  return {
    dayNumber,
    mealTime,
    recipeId: recipe.id,
    name: recipe.title,
    calories: scaledNutrition.calories,
    protein: scaledNutrition.protein,
    fat: scaledNutrition.fat,
    carbs: scaledNutrition.carbs,
    portionWeight: scaledNutrition.portionWeight,
    recipe: storedRecipe
  };
}

async function planWeeklyMenu({ userId, dailyCalories, protein, fat, carbs }) {
  const profile = await getPlannerPreferenceProfile(userId);
  const context = {
    usedRecipeIds: new Set(),
    titleCounts: new Map(),
    cuisineCounts: new Map(),
    lastBreakfastTitle: null
  };

  const days = [];
  const mealTimes = ['breakfast', 'lunch', 'dinner'];

  for (let dayNumber = 1; dayNumber <= 7; dayNumber++) {
    const meals = [];

    for (const mealTime of mealTimes) {
      const targets = buildMealTargets(dailyCalories, protein, fat, carbs, mealTime);
      const recipe = await chooseRecipeForMeal(profile, mealTime, targets, context);

      if (!recipe) {
        return null;
      }

      meals.push(convertRecipeToMeal(dayNumber, mealTime, recipe, targets));
      updateSelectionContext(context, recipe, mealTime);
    }

    days.push({ dayNumber, meals });
  }

  return { days };
}

module.exports = {
  planWeeklyMenu
};
