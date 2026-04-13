-- ===========================================
-- Clawmpany — Supabase Cloud Migration
-- ===========================================
-- Paste this into: Supabase Dashboard → SQL Editor → New Query
-- ===========================================

-- Auto-update updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- TABLES
-- ===========================================

CREATE TABLE servers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT DEFAULT 'root',
  ip TEXT,
  password TEXT,
  cpu INTEGER NOT NULL DEFAULT 2,
  ram INTEGER NOT NULL DEFAULT 4,
  storage INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'occupied', 'offline')),
  is_purchased BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE offices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  server_id UUID REFERENCES servers(id) ON DELETE SET NULL,
  expired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE credits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  balance BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNPAID'
    CHECK (status IN ('UNPAID', 'PAID', 'EXPIRED', 'FAILED')),
  url TEXT,
  method TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('DEBIT', 'CREDIT')),
  amount BIGINT NOT NULL,
  description TEXT,
  ref TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===========================================
-- INDEXES
-- ===========================================

CREATE INDEX idx_servers_status ON servers (status);
CREATE INDEX idx_servers_spec ON servers (cpu, ram, storage);
CREATE INDEX idx_offices_user_id ON offices (user_id);
CREATE INDEX idx_offices_server_id ON offices (server_id);
CREATE INDEX idx_credits_user_id ON credits (user_id);
CREATE INDEX idx_payments_user_id ON payments (user_id);
CREATE INDEX idx_payments_status ON payments (status);
CREATE INDEX idx_payments_metadata ON payments USING GIN (metadata);
CREATE INDEX idx_transactions_user_id ON transactions (user_id);

-- ===========================================
-- TRIGGERS (auto-update updated_at)
-- ===========================================

CREATE TRIGGER trg_servers_updated_at
  BEFORE UPDATE ON servers FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_offices_updated_at
  BEFORE UPDATE ON offices FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_credits_updated_at
  BEFORE UPDATE ON credits FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ===========================================
-- RLS — Service role bypasses automatically
-- ===========================================

ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON servers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON offices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON credits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON transactions FOR ALL USING (true) WITH CHECK (true);
