const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateMacros } = require('../src/services/macrosService');
const { convertRecipeToMeal, getScaledPortionWeight, scorePortionFit, scoreMacroFit } = require('../src/services/menuPlannerService');

test('weight-loss macros keep fat tied to body weight and carbs use the remainder', () => {
  const macros = calculateMacros({ calories: 2200, weight: 97, goal: 'lose' });

  assert.equal(macros.protein, 175);
  assert.equal(macros.fat, 68);
  assert.equal(macros.carbs, 222);
  assert.equal(macros.protein * 4 + macros.fat * 9 + macros.carbs * 4, 2200);
});

test('planner keeps recipe ingredients and menu nutrition on one serving basis', () => {
  const meal = convertRecipeToMeal(1, 'breakfast', {
    id: 42,
    title: 'Test breakfast',
    sourceType: 'pdf_book_recipe',
    ingredients: [{ name: 'Eggs', amount: 4, unit: 'pcs' }],
    instructions: ['Cook'],
    cookingTimeMinutes: 10,
    nutrition: {
      calories: 800,
      protein: 40,
      fat: 40,
      carbs: 80,
      fiber: 4,
      portionWeight: 400
    }
  }, {
    calories: 400,
    protein: 20,
    fat: 20,
    carbs: 40
  });

  assert.equal(meal.calories, 400);
  assert.equal(meal.fat, 20);
  assert.deepEqual(meal.recipe.ingredients, ['2 pcs Eggs']);
  assert.equal(meal.recipe.nutrition.calories, meal.calories);
  assert.equal(meal.recipe.nutrition.fat, meal.fat);
});

test('planner divides batch ingredients by recipe servings before calorie scaling', () => {
  const meal = convertRecipeToMeal(1, 'breakfast', {
    id: 43,
    title: 'Batch oats',
    servings: 4,
    ingredients: [{ name: 'Oats', amount: 400, unit: 'g' }],
    instructions: ['Mix'],
    nutrition: {
      calories: 400,
      protein: 16,
      fat: 8,
      carbs: 60,
      fiber: 8,
      portionWeight: 120
    }
  }, {
    calories: 200,
    protein: 8,
    fat: 4,
    carbs: 30
  });

  assert.deepEqual(meal.recipe.ingredients, ['50 g Oats']);
  assert.equal(meal.portionWeight, 60);
});

test('planner does not turn an unknown portion weight into zero grams', () => {
  const meal = convertRecipeToMeal(1, 'lunch', {
    id: 44,
    title: 'Unknown portion',
    servings: 2,
    ingredients: [{ name: 'Tomato', amount: 2, unit: 'pcs' }],
    nutrition: { calories: 500, protein: 20, fat: 10, carbs: 50, portionWeight: null }
  }, { calories: 500, protein: 20, fat: 10, carbs: 50 });

  assert.equal(meal.portionWeight, null);
  assert.equal(meal.recipe.nutrition.portionWeight, null);
});

test('planner prefers a normal plate size after calorie scaling', () => {
  const recipe = {
    nutrition: { calories: 400, portionWeight: 100 }
  };

  assert.equal(getScaledPortionWeight(recipe, 800), 200);
  assert.equal(scorePortionFit(recipe, 800), 100);
  assert.ok(scorePortionFit({ nutrition: { calories: 800, portionWeight: 400 } }, 800) < scorePortionFit(recipe, 800));
});

test('planner scores macro profile after calorie scaling', () => {
  const targets = { calories: 700, protein: 50, fat: 18, carbs: 88 };
  const balanced = { nutrition: { calories: 350, protein: 25, fat: 9, carbs: 44 } };
  const highFat = { nutrition: { calories: 350, protein: 25, fat: 18, carbs: 24 } };

  assert.ok(scoreMacroFit(balanced, targets) < scoreMacroFit(highFat, targets));
});
