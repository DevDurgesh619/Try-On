# Operational queries

Run against the production D1 database with:
```bash
wrangler d1 execute tryon-db --remote --command="<paste a query below>"
```

Or interactively:
```bash
wrangler d1 execute tryon-db --remote --file=<(echo "<query>")
```

The three numbers that matter most while validating product-market fit:

## 1. Activation — % of signed-in users who completed at least one generation

```sql
SELECT
  COUNT(*) AS total_users,
  SUM(CASE WHEN last_generated_at IS NOT NULL THEN 1 ELSE 0 END) AS activated,
  ROUND(
    SUM(CASE WHEN last_generated_at IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*),
    1
  ) AS activation_pct
FROM users;
```

Healthy beta: > 70%.

## 2. Paywall conversion-readiness — users who hit out_of_credits

```sql
SELECT COUNT(*) AS users_at_paywall
FROM users
WHERE free_credits_used >= 5
  AND paid_credits_balance = 0;
```

These are the people you'd ping when paid plans launch. Cross-reference with
the `waitlist` table:

```sql
SELECT u.email
FROM users u
JOIN waitlist w ON w.user_id = u.id OR w.email = u.email
WHERE u.free_credits_used >= 5 AND u.paid_credits_balance = 0;
```

## 3. 7-day retention — users who generated again ≥7 days after first-gen

```sql
WITH first_gen AS (
  SELECT user_id, MIN(created_at) AS first_at
  FROM ledger
  WHERE reason = 'generate'
  GROUP BY user_id
)
SELECT COUNT(DISTINCT l.user_id) AS retained_7d
FROM ledger l
JOIN first_gen f ON f.user_id = l.user_id
WHERE l.reason = 'generate'
  AND l.created_at - f.first_at >= 7 * 86400 * 1000;
```

For % retention, divide by total activated users from query #1.

---

## Other useful one-offs

### Total Gemini calls in the last 24 hours
```sql
SELECT COUNT(*) FROM ledger
WHERE reason = 'generate'
  AND created_at >= (strftime('%s','now') - 86400) * 1000;
```

Sanity-check against your $300 budget (~5,400 generations total).

### Top 10 highest-volume users
```sql
SELECT u.email, COUNT(*) AS generations
FROM ledger l JOIN users u ON u.id = l.user_id
WHERE l.reason = 'generate'
GROUP BY u.email
ORDER BY generations DESC
LIMIT 10;
```

If a single user is generating > 50/day repeatedly, the daily cap is working as
intended — but it's worth manually checking that account isn't compromised.

### Manual credit grant (admin)
```sql
-- Grant 30 credits to a user (e.g., to compensate for a bad generation).
INSERT INTO ledger (id, user_id, delta, reason, external_id, created_at)
VALUES (
  lower(hex(randomblob(16))),
  '<USER_ID>',
  30,
  'admin_grant',
  NULL,
  strftime('%s','now') * 1000
);

UPDATE users
SET paid_credits_balance = paid_credits_balance + 30
WHERE id = '<USER_ID>';
```

Run both in a single `wrangler d1 execute --file=...` invocation so they commit
together.

### Emergency: lock a user out
```sql
-- Sets credits to zero so the next /generate call returns out_of_credits.
UPDATE users
SET free_credits_used = 5, paid_credits_balance = 0
WHERE google_sub = '<GOOGLE_SUB>';
```

Don't delete the row — the ledger references it.
