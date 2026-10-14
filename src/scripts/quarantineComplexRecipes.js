const db = require('../services/db');

function getReasons(row) {
  const reasons = [];
  if (row.portion_weight === null || Number(row.portion_weight) <= 0) reasons.push('missing_portion_weight');

  const nutritionFields = ['calories', 'protein', 'fat', 'carbs'];
  if (nutritionFields.some((field) => row[field] === null || row[field] === undefined)) {
    reasons.push('incomplete_nutrition');
  } else {
    const macroCalories = Number(row.protein) * 4 + Number(row.fat) * 9 + Number(row.carbs) * 4;
    const calories = Number(row.calories);
    if (calories > 0 && Math.abs(calories - macroCalories) / calories > 0.25) {
      reasons.push('macro_calorie_mismatch');
    }
  }

  return reasons;
}

function getDensity(row) {
  const portionWeight = Number(row.portion_weight);
  if (!Number.isFinite(portionWeight) || portionWeight <= 0) return null;
  return {
    caloriesPer100g: Number(row.calories) / portionWeight * 100,
    fatPer100g: Number(row.fat) / portionWeight * 100
  };
}

function getDisposition(row) {
  const reasons = getReasons(row);
  const density = getDensity(row);

  if (density && density.caloriesPer100g > 300) reasons.push('calorie_density_over_300_per_100g');
  if (density && density.fatPer100g > 20) reasons.push('fat_density_over_20g_per_100g');

  if (reasons.length > 0) return { status: 'quarantine', reasons, density };

  const reviewReasons = [];
  if (density && density.caloriesPer100g > 250) reviewReasons.push('calorie_density_250_300_per_100g');
  if (density && density.fatPer100g > 15) reviewReasons.push('fat_density_15_20g_per_100g');
  if (reviewReasons.length > 0) return { status: 'review', reasons: reviewReasons, density };

  return { status: 'active', reasons: [], density };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const client = await db.pool.connect();
  try {
    const result = await client.query(
      `SELECT r.id, r.title, rn.calories, rn.protein, rn.fat, rn.carbs, rn.portion_weight
       FROM recipes r
       LEFT JOIN recipe_nutrition rn ON rn.recipe_id = r.id
       WHERE r.status = 'active'
       ORDER BY r.id`
    );

    const decisions = result.rows.map((row) => ({ row, decision: getDisposition(row) }));
    const candidates = decisions.filter(({ decision }) => decision.status !== 'active');

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      activeRecipes: result.rows.length,
      quarantineCandidates: candidates.length,
      quarantineCount: candidates.filter(({ decision }) => decision.status === 'quarantine').length,
      reviewCount: candidates.filter(({ decision }) => decision.status === 'review').length,
      keepActive: decisions.filter(({ decision }) => decision.status === 'active').length,
      reasonCounts: candidates.reduce((counts, { decision }) => {
        decision.reasons.forEach((reason) => { counts[reason] = (counts[reason] || 0) + 1; });
        return counts;
      }, {})
    }, null, 2));

    if (!apply || candidates.length === 0) return;

    await client.query('BEGIN');
    for (const { row, decision } of candidates) {
      await client.query(
        `UPDATE recipes
         SET status = $2,
             quality_report = COALESCE(quality_report, '{}'::jsonb) || $3::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id, decision.status, JSON.stringify({
          servingQualityGate: true,
          densityReasons: decision.reasons,
          caloriesPer100g: decision.density?.caloriesPer100g || null,
          fatPer100g: decision.density?.fatPer100g || null,
          reviewedAt: new Date().toISOString()
        })]
      );
    }
    await client.query('COMMIT');
    console.log(`Updated ${candidates.length} recipes: ${candidates.filter(({ decision }) => decision.status === 'quarantine').length} quarantined, ${candidates.filter(({ decision }) => decision.status === 'review').length} moved to review.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
