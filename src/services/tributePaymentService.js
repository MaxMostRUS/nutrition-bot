const crypto = require('crypto');
const db = require('./db');

function verifyTributeSignature(rawBody, signature, apiKey) {
  if (!rawBody || !signature || !apiKey) return false;
  const expected = crypto.createHmac('sha256', apiKey).update(rawBody).digest('hex');
  const received = String(signature).trim();
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

async function handleTributeEvent(event) {
  const payload = event?.payload || {};
  const purchaseId = Number(payload.purchase_id);
  const productId = Number(payload.product_id);
  const telegramUserId = Number(payload.telegram_user_id);
  if (!Number.isSafeInteger(purchaseId) || !Number.isSafeInteger(productId) || !Number.isSafeInteger(telegramUserId)) {
    throw new Error('Tribute event has invalid identifiers');
  }

  const user = await db.query('SELECT id, premium_until FROM users WHERE telegram_id = $1', [telegramUserId]);
  if (!user.rows.length) throw new Error('Tribute event user is not registered');

  if (event.name === 'digital_product_refunded') {
    await db.query(
      `UPDATE tribute_payments SET status = 'refunded', raw_event = $1::jsonb
       WHERE purchase_id = $2`,
      [JSON.stringify(event), purchaseId]
    );
    return { status: 'refunded', userId: user.rows[0].id };
  }

  if (event.name !== 'new_digital_product') throw new Error(`Unsupported Tribute event: ${event.name}`);

  const existing = await db.query('SELECT id FROM tribute_payments WHERE purchase_id = $1', [purchaseId]);
  if (existing.rows.length) return { status: 'duplicate', userId: user.rows[0].id };

  const currentUntil = user.rows[0].premium_until && new Date(user.rows[0].premium_until) > new Date()
    ? new Date(user.rows[0].premium_until)
    : new Date();
  const premiumUntil = new Date(currentUntil);
  premiumUntil.setUTCDate(premiumUntil.getUTCDate() + 30);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tribute_payments (
        user_id, purchase_id, product_id, telegram_user_id, amount, currency, event_name, raw_event
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        user.rows[0].id,
        purchaseId,
        productId,
        telegramUserId,
        payload.amount ?? null,
        payload.currency ?? null,
        event.name,
        JSON.stringify(event)
      ]
    );
    await client.query('UPDATE users SET premium_until = $1 WHERE id = $2', [premiumUntil, user.rows[0].id]);
    await client.query('COMMIT');
    return { status: 'paid', userId: user.rows[0].id, premiumUntil };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { verifyTributeSignature, handleTributeEvent };
