# Monetization Plan

## Test period

- 7 days free for a new user via `/trial`.
- No card details and no automatic renewal.
- During the trial, measure menu generations, recipe opens, adaptations, retention and support questions.

## Launch offer

- `199 XTR` for 30 days during the first launch cohort.
- The plan includes the recipe catalog, weekly menus, culinary adaptations, shopping lists and new imported recipes.
- Access is extended from the current `premium_until`, so an early renewal does not discard remaining days.
- No automatic recurring charge; the user renews manually with `/premium`.

## Price evolution

After the first 100-200 paying users or four weeks of data, test `299 XTR` for 30 days. Keep an annual offer only after retention is known, for example `2,499 XTR` for 12 months. The exact customer price of Stars can vary by region, taxes and the user's purchase channel.

Telegram's developer terms state that the reward value assigned to one Star is approximately $0.013, while purchase prices can vary. Therefore the product should be priced in Stars in the Telegram UI, and revenue should be evaluated after refunds and the availability delay rather than by a fixed currency conversion.

## Refund and support policy

- Store `telegram_payment_charge_id` for every successful payment.
- Process a refund through Telegram's Stars refund method when the service cannot be delivered or a duplicate charge is confirmed.
- Keep a support command and a manual lookup by Telegram payment charge id before public launch.
