const fs = require('fs');
const path = require('path');

const webRecipeSources = require('../data/webRecipeSources');
const {
  discoverSourceCandidates,
  fetchAndMapCandidate,
  finalizeRecipe,
  mapWithConcurrency
} = require('../services/webRecipePipeline');
const { estimateRecipeNutrition, loadFoodIndex } = require('../services/recipeNutritionEstimator');

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [key, ...valueParts] = item.slice(2).split('=');
    args[key] = valueParts.length ? valueParts.join('=') : true;
  }
  return args;
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function normalizedCandidateKey(candidate) {
  const url = new URL(candidate.url);
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().toLowerCase();
}

function makeReport(options) {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    mode: options.dryRun ? 'dry-run' : 'database-import',
    activateEligible: options.activateEligible,
    sourceCount: 0,
    discoveredCandidates: 0,
    uniqueCandidates: 0,
    duplicateCandidateUrls: 0,
    fetchedCandidates: 0,
    parsedRecipes: 0,
    rejectedByParserOrCriticalQa: 0,
    excludedByLicensePolicy: 0,
    importedOrUpdated: 0,
    importFailures: 0,
    databaseRowsTouched: null,
    databaseUniqueSourceUrls: null,
    databaseUniqueContentHashes: null,
    fetchFailures: 0,
    byLanguage: {},
    byMealType: {},
    byStatus: {},
    nutritionCoverage: {
      caloriesPresent: 0,
      fullMacrosPresent: 0,
      cookingTimePresent: 0,
      cuisinePresent: 0,
      estimatedByUsda: 0,
      estimationSkipped: 0
    },
    bySource: {},
    quality: { eligibleForActivation: 0, criticalFailure: 0, warningCount: 0 },
    samples: [],
    failures: []
  };
}

function addFailure(report, source, candidate, error) {
  report.fetchFailures += 1;
  if (report.failures.length < 100) {
    report.failures.push({ sourceId: source.id, url: candidate.url, error: error.message });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedIds = args.source ? new Set(String(args.source).split(',').filter(Boolean)) : null;
  const selectedLanguages = args.language ? new Set(String(args.language).split(',').filter(Boolean)) : null;
  const limitPerSource = Math.max(0, Number(args.limitPerSource ?? args.limitPerCollection ?? 0) || 0);
  const concurrency = Math.max(1, Math.min(8, Number(args.concurrency) || 4));
  const options = {
    dryRun: Boolean(args.dryRun),
    activateEligible: Boolean(args.activateEligible),
    timeoutMs: Math.max(1000, Number(args.timeoutMs) || 20000),
    retries: Math.max(0, Number(args.retries ?? 2)),
    estimateNutrition: Boolean(args.estimateNutrition)
  };
  const nutritionIndex = options.estimateNutrition
    ? loadFoodIndex(args.foodIndex ? path.resolve(args.foodIndex) : undefined)
    : null;
  const reportPath = path.resolve(args.report || 'reports/web-recipe-import-latest.json');
  const report = makeReport(options);
  const discovered = [];
  let db = null;
  let importRecipeBatch = null;

  if (!options.dryRun) {
    ({ importRecipeBatch } = require('../services/recipeImportService'));
    db = require('../services/db');
  }

  try {
    const sources = webRecipeSources.filter((source) => {
      if (selectedIds && !selectedIds.has(source.id)) return false;
      if (selectedLanguages && !selectedLanguages.has(source.language)) return false;
      return true;
    });
    report.sourceCount = sources.length;

    for (const source of sources) {
      console.log(`Discovering ${source.id} from ${source.collectionUrl}`);
      try {
        const candidates = await discoverSourceCandidates(source, limitPerSource);
        report.discoveredCandidates += candidates.length;
        report.bySource[source.id] = {
          language: source.language,
          discovered: candidates.length,
          unique: 0,
          parsed: 0,
          importedOrUpdated: 0,
          failures: 0
        };
        discovered.push(...candidates.map((candidate) => ({ source, candidate })));
      } catch (error) {
        report.bySource[source.id] = { language: source.language, discovered: 0, unique: 0, parsed: 0, importedOrUpdated: 0, failures: 1 };
        addFailure(report, source, { url: source.collectionUrl }, error);
      }
    }

    const uniqueCandidates = [];
    const seen = new Set();
    for (const item of discovered) {
      const key = normalizedCandidateKey(item.candidate);
      if (seen.has(key)) {
        report.duplicateCandidateUrls += 1;
        continue;
      }
      seen.add(key);
      uniqueCandidates.push(item);
      report.bySource[item.source.id].unique += 1;
    }
    report.uniqueCandidates = uniqueCandidates.length;
    console.log(`Processing ${uniqueCandidates.length} unique candidates with concurrency=${concurrency}`);

    const processed = await mapWithConcurrency(uniqueCandidates, concurrency, async ({ source, candidate }, index) => {
      try {
        const fetchedRecipe = await fetchAndMapCandidate(source, candidate, options);
        report.fetchedCandidates += 1;
        if (!fetchedRecipe) {
          report.rejectedByParserOrCriticalQa += 1;
          return null;
        }
        const estimatedRecipe = nutritionIndex
          ? estimateRecipeNutrition(fetchedRecipe, nutritionIndex)
          : fetchedRecipe;
        const recipe = nutritionIndex
          ? finalizeRecipe(estimatedRecipe, source, options.activateEligible)
          : estimatedRecipe;
        report.parsedRecipes += 1;
        report.bySource[source.id].parsed += 1;
        if (recipe.qualityReport.critical.length) report.quality.criticalFailure += 1;
        if (recipe.qualityReport.eligibleForActivation) report.quality.eligibleForActivation += 1;
        report.quality.warningCount += recipe.qualityReport.warnings.length;
        if (report.samples.length < 30) {
          report.samples.push({
            title: recipe.title,
            url: recipe.sourceUrl,
            language: recipe.language,
            mealType: recipe.mealType,
            status: recipe.status,
            qualityScore: recipe.qualityScore,
            critical: recipe.qualityReport.critical,
            warnings: recipe.qualityReport.warnings
          });
        }
        if ((index + 1) % 50 === 0) console.log(`Processed ${index + 1}/${uniqueCandidates.length}`);
        return { source, recipe };
      } catch (error) {
        report.bySource[source.id].failures += 1;
        addFailure(report, source, candidate, error);
        return null;
      }
    });

    const valid = processed.filter(Boolean);
    const qaPassed = valid.filter(({ recipe }) => recipe.qualityReport.critical.length === 0);
    const importable = qaPassed.filter(({ source, recipe }) => (
      source.allowsImport !== false && recipe.provenance?.importAllowed !== false
    ));
    report.rejectedByParserOrCriticalQa += valid.length - qaPassed.length;
    report.excludedByLicensePolicy = qaPassed.length - importable.length;
    report.byLanguage = countBy(importable, ({ recipe }) => recipe.language);
    report.byMealType = countBy(importable, ({ recipe }) => recipe.mealType);
    report.byStatus = countBy(importable, ({ recipe }) => recipe.status);
    report.nutritionCoverage = {
      caloriesPresent: importable.filter(({ recipe }) => recipe.nutrition?.calories !== null && recipe.nutrition?.calories !== undefined).length,
      fullMacrosPresent: importable.filter(({ recipe }) => ['protein', 'fat', 'carbs'].every((key) => recipe.nutrition?.[key] !== null && recipe.nutrition?.[key] !== undefined)).length,
      cookingTimePresent: importable.filter(({ recipe }) => Boolean(recipe.cookingTimeMinutes)).length,
      cuisinePresent: importable.filter(({ recipe }) => Boolean(recipe.cuisine)).length,
      estimatedByUsda: importable.filter(({ recipe }) => recipe.provenance?.nutritionEstimate?.status === 'calculated').length,
      estimationSkipped: importable.filter(({ recipe }) => recipe.provenance?.nutritionEstimate?.status === 'skipped').length
    };

    if (!options.dryRun) {
      for (const { source, recipe } of importable) {
        try {
          const saved = await importRecipeBatch([recipe]);
          if (saved.length) {
            report.importedOrUpdated += saved.length;
            report.bySource[source.id].importedOrUpdated += saved.length;
          }
        } catch (error) {
          report.importFailures += 1;
          report.bySource[source.id].failures += 1;
          if (report.failures.length < 100) {
            report.failures.push({ sourceId: source.id, url: recipe.sourceUrl, stage: 'database-import', error: error.message });
          }
        }
      }

      const databaseSnapshot = await db.query(
        `SELECT
           count(*)::int AS rows_touched,
           count(DISTINCT normalized_source_url)::int AS unique_source_urls,
           count(DISTINCT content_hash)::int AS unique_content_hashes
         FROM recipes
         WHERE source_checked_at >= $1`,
        [report.startedAt]
      );
      report.databaseRowsTouched = databaseSnapshot.rows[0].rows_touched;
      report.databaseUniqueSourceUrls = databaseSnapshot.rows[0].unique_source_urls;
      report.databaseUniqueContentHashes = databaseSnapshot.rows[0].unique_content_hashes;
    }

    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      report: reportPath,
      mode: report.mode,
      sources: report.sourceCount,
      discovered: report.discoveredCandidates,
      unique: report.uniqueCandidates,
      parsed: report.parsedRecipes,
      qaPassed: importable.length,
      excludedByLicensePolicy: report.excludedByLicensePolicy,
      importedOrUpdated: report.importedOrUpdated,
      databaseRowsTouched: report.databaseRowsTouched,
      byLanguage: report.byLanguage,
      byStatus: report.byStatus,
      failures: report.fetchFailures + report.importFailures
    }, null, 2));
  } catch (error) {
    report.finishedAt = new Date().toISOString();
    report.fatalError = error.message;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error('Web recipe import failed:', error);
    process.exitCode = 1;
  } finally {
    if (db) await db.pool.end();
  }
}

if (require.main === module) main();

module.exports = { countBy, main, normalizedCandidateKey, parseArgs };
