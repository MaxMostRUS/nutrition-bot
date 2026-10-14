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

    const candidates = result.rows
      .map((row) => ({ row, reasons: getReasons(row) }))
      .filter(({ reasons }) => reasons.length > 0);

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      activeRecipes: result.rows.length,
      quarantineCandidates: candidates.length,
      keepActive: result.rows.length - candidates.length,
      reasonCounts: candidates.reduce((counts, { reasons }) => {
        reasons.forEach((reason) => { counts[reason] = (counts[reason] || 0) + 1; });
        return counts;
      }, {})
    }, null, 2));

    if (!apply || candidates.length === 0) return;

    await client.query('BEGIN');
    for (const { row, reasons } of candidates) {
      await client.query(
        `UPDATE recipes
         SET status = 'quarantine',
             quality_report = COALESCE(quality_report, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id, JSON.stringify({ quarantineReasons: reasons, quarantinedAt: new Date().toISOString() })]
      );
    }
    await client.query('COMMIT');
    console.log(`Quarantined ${candidates.length} recipes.`);
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
