const fs = require('fs');
const path = require('path');

const sources = require('../data/publicDomainCookbookSources');

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'nutrition-bot-recipe-research/2.0' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function auditSource(source) {
  const [catalogHtml, bookHtml] = await Promise.all([
    fetchText(source.catalogUrl),
    fetchText(source.htmlUrl)
  ]);
  const headingCounts = {};
  for (let level = 1; level <= 6; level++) {
    headingCounts[`h${level}`] = [...bookHtml.matchAll(new RegExp(`<h${level}\\b`, 'gi'))].length;
  }
  return {
    ...source,
    publicDomainConfirmed: /Public domain in the USA/i.test(catalogHtml),
    htmlBytes: Buffer.byteLength(bookHtml),
    headingCounts,
    candidateSectionCount: headingCounts.h3 + headingCounts.h4,
    importReady: false,
    note: 'Historical headings mix recipes and editorial sections; ingredient/step parsing requires book-specific review.'
  };
}

async function main() {
  const outputPath = path.resolve(process.argv[2] || 'reports/public-domain-cookbook-audit-2026-10-13.json');
  const audited = [];
  for (const source of sources) {
    try {
      audited.push(await auditSource(source));
    } catch (error) {
      audited.push({ ...source, publicDomainConfirmed: false, importReady: false, error: error.message });
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    publicDomainConfirmed: audited.filter((source) => source.publicDomainConfirmed).length,
    importReady: audited.filter((source) => source.importReady).length,
    sources: audited
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, ...report, sources: undefined }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { auditSource };
