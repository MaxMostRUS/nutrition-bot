const db = require('../services/db');
const { createRecipe, searchRecipes } = require('../services/recipeCatalogService');
const seedRecipes = require('../data/seedRecipes');

async function recipeExistsByTitle(title) {
  const found = await searchRecipes({
    searchText: title,
    limit: 5
  });

  return found.some((recipe) => recipe.title === title);
}

async function main() {
  try {
    let created = 0;
    let skipped = 0;

    for (const recipe of seedRecipes) {
      const exists = await recipeExistsByTitle(recipe.title);
      if (exists) {
        skipped += 1;
        console.log(`Skipping existing recipe: ${recipe.title}`);
        continue;
      }

      await createRecipe(recipe);
      created += 1;
      console.log(`Created recipe: ${recipe.title}`);
    }

    console.log(`Recipe seeding complete. Created: ${created}, skipped: ${skipped}`);
  } catch (error) {
    console.error('Recipe seeding failed:', error);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

main();
