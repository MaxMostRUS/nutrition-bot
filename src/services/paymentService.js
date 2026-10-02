const db = require('./db');

const TRIAL_DAYS = 7;
const PREMIUM_DAYS = 30;
const PREMIUM_PLAN_CODE = 'premium_30_days';
const PREMIUM_PLAN_STARS = Number(process.env.PREMIUM_PLAN_STARS || 199);

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function hasPremiumAccess(user) {
  return Boolean(user?.premium_until && new Date(user.premium_until) > new Date());
}

async function startTrial(userId) {
  const result = await db.query(
    `UPDATE users
     SET trial_started_at = COALESCE(trial_started_at, NOW()),
         premium_until = CASE
           WHEN trial_started_at IS NULL THEN NOW() + INTERVAL '7 days'
           ELSE premium_until
         END
     WHERE id = $1
     RETURNING premium_until, trial_started_at`,
    [userId]
  );

  if (!result.rows.length) throw new Error('User not found');
  return result.rows[0];
}

function buildPremiumInvoice() {
  return {
    title: 'NutriBot Premium на 30 дней',
    description: 'Персональные меню из проверенной базы рецептов, адаптация блюд и новые подборки.',
    payload: `${PREMIUM_PLAN_CODE}:${Date.now()}`,
    currency: 'XTR',
    prices: [{ label: 'Premium на 30 дней', amount: PREMIUM_PLAN_STARS }]
  };
}

async function recordSuccessfulPayment({ userId, payment }) {
  const chargeId = payment.telegram_payment_charge_id;
  const existing = await db.query(
    'SELECT id, user_id FROM payments WHERE telegram_payment_charge_id = $1',
    [chargeId]
  );
  if (existing.rows.length) return { duplicate: true, payment: existing.rows[0] };

  const userResult = await db.query('SELECT premium_until FROM users WHERE id = $1', [userId]);
  if (!userResult.rows.length) throw new Error('User not found');
  const currentUntil = userResult.rows[0].premium_until && new Date(userResult.rows[0].premium_until) > new Date()
    ? new Date(userResult.rows[0].premium_until)
    : new Date();
  const premiumUntil = addDays(currentUntil, PREMIUM_DAYS);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO payments (
        user_id, telegram_payment_charge_id, invoice_payload, plan_code,
        currency, total_amount, raw_payment
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
      RETURNING id, created_at`,
      [
        userId,
        chargeId,
        payment.invoice_payload,
        PREMIUM_PLAN_CODE,
        payment.currency,
        payment.total_amount,
        JSON.stringify(payment)
      ]
    );
    await client.query('UPDATE users SET premium_until = $1 WHERE id = $2', [premiumUntil, userId]);
    await client.query('COMMIT');
    return { duplicate: false, payment: inserted.rows[0], premiumUntil };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  PREMIUM_PLAN_CODE,
  PREMIUM_PLAN_STARS,
  TRIAL_DAYS,
  hasPremiumAccess,
  startTrial,
  buildPremiumInvoice,
  recordSuccessfulPayment
};
