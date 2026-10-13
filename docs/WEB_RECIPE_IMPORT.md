# Web recipe research and import

## What changed

The web importer is a source-driven research pipeline, not a seed generator. It discovers real source pages, records a revision or URL, parses only fields present on the page, runs QA, deduplicates candidates, and then optionally upserts eligible records into PostgreSQL.

The previous importer had four material risks:

- it labelled every web page `open-web`, which is not a license;
- it promoted parsed recipes directly to `active`;
- it deduplicated mostly by an unstable source/title key;
- it had no durable language, revision, fetch time, quality, or provenance fields.

The new pipeline defaults every imported recipe to `draft`. `--activateEligible` can only activate a record when the source permits automatic activation and the recipe has no critical errors, has cooking time, and has calories plus protein/fat/carbohydrates. Missing optional fields stay `null`; the importer does not invent them.

## Sources and licensing policy

| Source | Languages | Use in pipeline | License decision |
|---|---|---|---|
| Wikibooks / Wikilibros recipe collections | EN, ES, RU | Discovery and database import | CC BY-SA 4.0; revision id, permalink and attribution are stored |
| MedlinePlus recipe collections | EN, ES | Research candidates only | MedlinePlus contains both public-domain and licensed content; excluded from database import until per-recipe reuse is verified |
| Nutrition.gov | EN | Per-recipe license gate and database import | Only recipes whose structured creator URL belongs to `usda.gov` or `myplate.gov` are treated as US federal public-domain works; all other creators are excluded |
| MakeBetterFood.com | EN | Research candidates only | CC BY-NC-SA 3.0; excluded because the product may be commercial |

The MedlinePlus restriction follows its official [content reuse guidance](https://medlineplus.gov/about/using/usingcontent/). Wikibooks provenance points to the Wikimedia [Terms of Use](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use) and stores the exact revision used. MakeBetterFood's [license page](https://www.makebetterfood.com/about/license.html) is stored with every research candidate. Nutrition.gov is a mixed-origin catalogue, so a generic `.gov` suffix is not sufficient: the importer uses a narrow federal-domain allowlist.

Four Project Gutenberg cookbooks (one English and three Spanish) are tracked in `src/data/publicDomainCookbookSources.js`. `npm run research:books` verifies each catalogue page and records structural counts in `reports/public-domain-cookbook-audit-2026-10-13.json`. The books are confirmed public domain in the USA, but are not imported yet because historical headings mix recipes with editorial sections and do not reliably separate ingredient quantities from instructions.

## Runbook

Install dependencies and apply migrations:

```bash
npm install
npm run migrate
```

Run research and QA without a database write:

```bash
npm run import:web:recipes -- \
  --dryRun \
  --concurrency=4 \
  --report=reports/web-recipe-import.json
```

Build the local USDA SR Legacy index and calculate missing per-serving nutrition from measured ingredients:

```bash
npm run prepare:usda-foods
npm run import:web:recipes -- \
  --estimateNutrition \
  --report=reports/web-recipe-db-import.json
```

The compact index is generated under `.cache/` from the official FoodData Central download and is intentionally not committed. A calculation succeeds only when servings are known and every significant ingredient has a quantity, a high-confidence food match, and a convertible mass/portion. The recipe provenance records the FDC id, matched food, gram weight, match score, dataset release, and fields filled. Existing published nutrition is preserved. Unresolved recipes keep `null` nutrition and remain drafts.

Import eligible records as `draft`:

```bash
npm run import:web:recipes -- \
  --concurrency=4 \
  --report=reports/web-recipe-db-import.json
```

Useful controls:

- `--source=wikibooks-en-recipes,wikibooks-es-recipes,wikibooks-ru-recipes`
- `--language=en,es,ru`
- `--limitPerSource=25` for a bounded smoke run
- `--retries=4` and `--timeoutMs=20000`
- `--activateEligible` for an explicit QA-gated activation attempt
- `--estimateNutrition` to calculate missing values using the prepared USDA index
- `--foodIndex=/absolute/path/index.json` to use another reviewed FoodData index

The MediaWiki discovery path batches page content and revisions to avoid one API call per recipe. HTML sources are fetched with bounded concurrency and retries. The report distinguishes discovery duplicates, parser/QA failures, license exclusions, database failures, and the number of distinct rows touched.

## Data and deduplication

Migrations `006` and `007` add:

- language, normalized source URL, source revision and check time;
- license URL and structured provenance;
- SHA-256 content hash;
- quality score and critical/warning report;
- support for multi-cuisine text longer than 100 characters.

Upsert order is embedding key, normalized URL, original URL, same-language content hash, then title/source fallback. Tracking parameters and URL fragments are removed before matching. This keeps reruns idempotent while retaining the original source URL.

## Verified 2026-10-13 run

The committed dry-run report is `reports/web-recipe-import-2026-10-13.json`. The local PostgreSQL integration report is `reports/web-recipe-db-import-2026-10-13.json`.

- 15 configured collections were contacted.
- 1,183 candidate links were discovered.
- 967 unique source pages were fetched and parsed.
- 372 otherwise valid MedlinePlus candidates were excluded by license policy.
- 335 CC BY-SA recipes passed critical QA and were imported/updated in the local dev database: 264 EN, 17 ES, 54 RU.
- 335 distinct database rows were touched; all remained `draft`; there were zero fetch or database failures.
- The imported source pages exposed calories for 2 recipes and complete protein/fat/carbohydrate values for 0 recipes; 143 had cooking time and 81 had cuisine. Missing nutrition is explicitly retained as `null` and blocks activation.

The language imbalance reflects actual parser/source completeness, not synthetic padding. Many Wikibooks recipes do not publish complete nutrition data. Those fields remain `null`, are listed in `quality_report.warnings`, and prevent automatic activation.

## Verified second pass, 2026-10-14

The research report is `reports/web-recipe-import-round2-2026-10-13.json` and the local database report is `reports/web-recipe-db-import-round2-2026-10-14.json`.

- 155 Nutrition.gov links and 100 MakeBetterFood links were discovered; 243 unique pages were processed and 242 parsed, with zero fetch failures.
- 50 recipes passed the strict federal-creator license gate; 190 otherwise valid recipes were excluded by license policy.
- All 50 federal recipes were imported or updated in the local development database as `draft`; production was untouched.
- Full calories/protein/fat/carbohydrates were calculated for 23 recipes using USDA SR Legacy. The other 27 stayed incomplete because servings, quantities, matches, or portion conversions were not sufficient.
- Four Project Gutenberg books were confirmed public domain in the USA and retained as extraction candidates; none was imported automatically.

## Review before activation

Before promoting a draft to `active`, verify attribution display, ingredients and steps, meal type, cuisine, serving basis, cooking time, and nutrition units. Estimated nutrition must retain the USDA match provenance and should be spot-checked before activation. No recipe is activated by the verified import commands above.
