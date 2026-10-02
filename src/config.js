let envLoaded = false;
try {
  const dotenvSafe = require('dotenv-safe');
  dotenvSafe.config({ allowEmptyValues: false });
  envLoaded = true;
} catch (e) {
  try {
    require('dotenv').config();
    envLoaded = true;
    console.warn('dotenv-safe not used (no .env.example?). Fallback to dotenv loaded.');
  } catch (e2) {
    console.warn('Failed to load environment from .env. Relying on process.env only.');
  }
}

function parseBooleanEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(String(value).trim())) return true;
  if (/^(0|false|no|off)$/i.test(String(value).trim())) return false;
  return fallback;
}

const PLANNER_MODE = process.env.PLANNER_MODE || 'hybrid';

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  GPT_MODEL: process.env.GPT_MODEL || 'gpt-4o-mini',
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  WEBHOOK_PATH: process.env.WEBHOOK_PATH,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
  TRIBUTE_API_KEY: process.env.TRIBUTE_API_KEY,
  TRIBUTE_PRODUCT_URL: process.env.TRIBUTE_PRODUCT_URL,
  TRIBUTE_PRODUCT_ID: process.env.TRIBUTE_PRODUCT_ID,
  TRIBUTE_WEBHOOK_PATH: process.env.TRIBUTE_WEBHOOK_PATH || '/webhook/tribute',
  PORT: process.env.PORT || 3000,
  PLANNER_MODE,
  MENU_LLM_FALLBACK_ENABLED: parseBooleanEnv(
    process.env.MENU_LLM_FALLBACK_ENABLED,
    PLANNER_MODE !== 'imported_only'
  )
};
