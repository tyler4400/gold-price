CREATE TABLE daily_prices (
  date TEXT NOT NULL,
  item_key TEXT NOT NULL,
  price REAL NOT NULL CHECK (price > 0),
  unit TEXT NOT NULL CHECK (unit = 'CNY/g'),
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (date, item_key)
);
CREATE INDEX daily_prices_item_date ON daily_prices (item_key, date);

CREATE TABLE subscribers (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'unsubscribed')),
  verified_at TEXT,
  verification_token_hash TEXT,
  verification_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL CHECK (item_key = 'sge_au9999'),
  lower_price REAL CHECK (lower_price > 0),
  upper_price REAL CHECK (upper_price > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_notified_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (subscriber_id, item_key),
  CHECK (lower_price IS NOT NULL OR upper_price IS NOT NULL),
  CHECK (lower_price IS NULL OR upper_price IS NULL OR lower_price < upper_price)
);
