const db = require('../services/db');
const { generateRecipe } = require('./menuController');

function parseRecipePayload(value) {
    if (!value) {
        return { ingredients: [], steps: [], cookingTimeMinutes: 0 };
    }

    try {
        return typeof value === 'string' ? JSON.parse(value) : value;
    } catch (err) {
        console.error('Error parsing stored recipe payload:', err);
        return { ingredients: [], steps: [], cookingTimeMinutes: 0 };
    }
}

async function persistMealRecipe(mealId, recipe) {
    try {
        await db.query('UPDATE meals SET recipe = $1::jsonb WHERE id = $2', [JSON.stringify(recipe), mealId]);
    } catch (error) {
        await db.query('UPDATE meals SET recipe = $1 WHERE id = $2', [JSON.stringify(recipe), mealId]);
    }
}

async function ensureRecipeForMealRow(row) {
    if (!row) return null;

    if (row.recipe && row.recipe.baseRecipeId) {
      return {
            name: row.name,
            recipe: parseRecipePayload(row.recipe)
        };
    }

    const recipe = await generateRecipe({
        recipeId: row.recipe_id,
        name: row.name,
        calories: row.calories,
        protein: row.protein,
        fat: row.fat,
        carbs: row.carbs,
        portion: row.portion_weight
    }, row.goal);

    await persistMealRecipe(row.id, recipe);

    return {
        name: row.name,
        recipe
    };
}

async function getRecipeByMealId(mealId) {
    console.log('Fetching recipe for meal:', mealId);
    try {
        const res = await db.query(
            `SELECT
                m.id,
                m.recipe_id,
                m.name,
                m.calories,
                m.protein,
                m.fat,
                m.carbs,
                m.portion_weight,
                m.recipe,
                u.goal
             FROM meals m
             JOIN menus mn ON mn.id = m.menu_id
             JOIN users u ON u.id = mn.user_id
             WHERE m.id = $1`,
            [mealId]
        );
        if (res.rows.length === 0) {
            console.log('No meal found with id:', mealId);
            return null;
        }

        const row = res.rows[0];
        console.log('Found meal:', row.name);
        return ensureRecipeForMealRow(row);
    } catch (err) {
        console.error('Database error while fetching recipe:', err);
        return null;
    }
}

async function ensureRecipesForMenuId(menuId) {
    const res = await db.query(
        `SELECT
            m.id,
            m.recipe_id,
            m.name,
            m.calories,
            m.protein,
            m.fat,
            m.carbs,
            m.portion_weight,
            m.recipe,
            u.goal
         FROM meals m
         JOIN menus mn ON mn.id = m.menu_id
         JOIN users u ON u.id = mn.user_id
         WHERE m.menu_id = $1
         ORDER BY m.id ASC`,
        [menuId]
    );

    const meals = [];
    for (const row of res.rows) {
        const ensured = await ensureRecipeForMealRow(row);
        meals.push({
            name: ensured?.name || row.name,
            recipe: ensured?.recipe || { ingredients: [], steps: [], cookingTimeMinutes: 0 }
        });
    }

    return meals;
}

module.exports = {
    getRecipeByMealId,
    ensureRecipesForMenuId
};
