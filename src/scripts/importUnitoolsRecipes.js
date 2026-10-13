const { importRecipeBatch } = require('../services/recipeImportService');
const db = require('../services/db');

const DATASET_URL = process.env.UNITOOLS_RECIPES_URL
  || 'https://theunitools.com/data/unitools-recipes-v1.json';
const DATASET_PAGE = 'https://theunitools.com/en/data';

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [key, value] = item.slice(2).split('=');
    args[key] = value === undefined ? true : value;
  }
  return args;
}

function mealTypeFor(recipe, index) {
  if (recipe.category === 'breakfast') return 'breakfast';
  if (recipe.category === 'soup' || recipe.category === 'salad') return 'lunch';
  // The dataset marks these as main dishes rather than lunch/dinner.
  return index % 2 === 0 ? 'lunch' : 'dinner';
}

function mapRecipe(recipe, index, language) {
  const name = recipe.name?.[language] || recipe.name?.ru || recipe.name?.en;
  const summary = recipe.summary?.[language] || recipe.summary?.ru || recipe.summary?.en || '';
  const cuisine = recipe.cuisine?.[language] || recipe.cuisine?.ru || recipe.cuisine?.en || null;
  const steps = (Array.isArray(recipe.steps) ? recipe.steps : [])
    .map((step) => step.text?.[language] || step.text?.ru || step.text?.en || '')
    .filter(Boolean);

  if (!name || !steps.length || !Array.isArray(recipe.ingredients) || !recipe.ingredients.length) {
    return null;
  }

  return {
    title: name,
    description: summary,
    instructions: steps,
    servings: recipe.baseServings,
    cookingTimeMinutes: Number(recipe.prepMinutes || 0) + Number(recipe.cookMinutes || 0),
    difficulty: recipe.difficulty || null,
    cuisine,
    mealType: mealTypeFor(recipe, index),
    sourceType: 'open_dataset_unitools',
    sourceTitle: 'UniTools World Recipes',
    // Keep a stable per-recipe provenance key; the importer upserts non-PDF
    // records by source URL before checking the embedding key.
    sourceUrl: `${DATASET_PAGE}#${recipe.slug}`,
    license: 'CC BY-SA 4.0',
    embeddingKey: `unitools:${recipe.slug}:${language}`,
    tags: [
      'healthy',
      'open-dataset',
      'license:cc-by-sa-4.0',
      `lang:${language}`,
      `category:${recipe.category}`,
      ...(Array.isArray(recipe.diets) ? recipe.diets.map((diet) => `diet:${diet}`) : [])
    ],
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name?.[language] || ingredient.name?.ru || ingredient.name?.en,
      canonicalName: ingredient.id,
      amount: ingredient.quantity,
      unit: ingredient.unit,
      note: ingredient.note?.[language] || ingredient.note?.ru || ingredient.note?.en || null
    })),
    nutrition: {
      calories: recipe.nutritionPerServing?.calories,
      protein: recipe.nutritionPerServing?.protein,
      fat: recipe.nutritionPerServing?.fat,
      carbs: recipe.nutritionPerServing?.carbs,
      fiber: recipe.nutritionPerServing?.fiber || null,
      portionWeight: null
    },
    status: 'active'
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const language = String(args.language || 'ru');
  const limit = Math.max(1, Number(args.limit) || 1000);
  if (!['ru', 'en'].includes(language)) throw new Error(`Unsupported language: ${language}`);

  try {
    const response = await fetch(DATASET_URL);
    if (!response.ok) throw new Error(`Failed to fetch dataset: ${response.status}`);
    const payload = await response.json();
    const recipes = (payload.recipes || [])
      .filter((recipe) => ['breakfast', 'main', 'salad', 'soup'].includes(recipe.category))
      .slice(0, limit)
      .map((recipe, index) => mapRecipe(recipe, index, language))
      .filter(Boolean);

    const saved = await importRecipeBatch(recipes);
    console.log(`UniTools import completed: ${saved.length}/${recipes.length} recipes`);
  } finally {
    await db.pool.end();
  }
}

main().catch((error) => {
  console.error('UniTools import failed:', error);
  process.exitCode = 1;
});
