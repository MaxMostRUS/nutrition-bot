const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('../services/db');
const pdfBookSources = require('../data/pdfBookSources');
const { ingestKnowledgeDocument } = require('../services/knowledgeBaseService');

function getPythonCommand() {
  const candidates = [
    process.env.CODEX_PYTHON,
    '/Users/maxmostovskoy/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
    'python3'
  ].filter(Boolean);

  return candidates.find((candidate) => {
    if (candidate === 'python3') return true;
    return fs.existsSync(candidate);
  });
}

function runExtractor(pythonCommand, pdfPath) {
  const scriptPath = path.resolve(__dirname, 'extract_pdf_chunks.py');
  const result = spawnSync(pythonCommand, [scriptPath, pdfPath], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Extractor failed for ${pdfPath}`);
  }

  return JSON.parse(result.stdout);
}

async function main() {
  const pythonCommand = getPythonCommand();
  if (!pythonCommand) {
    throw new Error('Python 3 with pdfplumber is required for PDF ingestion.');
  }

  try {
    for (const source of pdfBookSources) {
      if (!fs.existsSync(source.filePath)) {
        console.warn(`Skipping missing PDF: ${source.filePath}`);
        continue;
      }

      console.log(`Ingesting PDF knowledge: ${source.title}`);
      const extracted = runExtractor(pythonCommand, source.filePath);
      const chunks = extracted.pages.flatMap((page) => page.chunks);

      await ingestKnowledgeDocument(
        {
          title: source.title || extracted.title,
          sourceType: source.sourceType || 'pdf_recipe_book',
          filePath: source.filePath,
          pageCount: extracted.pageCount,
          metadata: {
            tags: source.tags || [],
            originalTitle: extracted.title
          }
        },
        chunks
      );

      console.log(`Stored ${chunks.length} chunks from ${source.title}`);
    }

    console.log('PDF knowledge ingestion completed.');
  } catch (error) {
    console.error('PDF knowledge ingestion failed:', error);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

main();
