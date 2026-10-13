const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateMacros } = require('../src/services/macrosService');
const { convertRecipeToMeal } = require('../src/services/menuPlannerService');

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
