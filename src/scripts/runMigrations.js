const fs = require('fs');
const path = require('path');
const db = require('../services/db');

const sqlDir = path.resolve(__dirname, '../../sql');
const migrationsDir = path.join(sqlDir, 'migrations');
const initFile = path.join(sqlDir, 'init.sql');

async function ensureBaseSchema(client) {
  if (!fs.existsSync(initFile)) {
    throw new Error(`Base schema file not found: ${initFile}`);
  }

  const initSql = fs.readFileSync(initFile, 'utf8').trim();
  if (!initSql) {
    throw new Error('Base schema file is empty');
  }

  await client.query(initSql);
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

function getMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

async function getAppliedMigrations(client) {
  const result = await client.query('SELECT version FROM schema_migrations');
  return new Set(result.rows.map((row) => row.version));
}

async function applyMigration(client, filename) {
  const fullPath = path.join(migrationsDir, filename);
  const sql = fs.readFileSync(fullPath, 'utf8').trim();

  if (!sql) {
    console.log(`Skipping empty migration: ${filename}`);
    return;
  }

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
      [filename]
    );
    await client.query('COMMIT');
    console.log(`Applied migration: ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const client = await db.pool.connect();

  try {
    console.log('Ensuring base schema from sql/init.sql...');
    await ensureBaseSchema(client);

    console.log('Ensuring schema_migrations table...');
    await ensureMigrationTable(client);

    const files = getMigrationFiles();
    const applied = await getAppliedMigrations(client);

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skipping already applied migration: ${file}`);
        continue;
      }

      await applyMigration(client, file);
    }

    console.log('Migrations completed successfully.');
  } catch (error) {
    console.error('Migration run failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
