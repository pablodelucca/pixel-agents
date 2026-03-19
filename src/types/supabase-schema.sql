-- Server table
create table if not exists servers (
  id UUID default gen_random_uuid () primary key,
  user_id UUID references auth.users,
  instance_id TEXT,
  name TEXT not null,
  status TEXT default 'pending',
  public_ip TEXT,
  region TEXT default 'ap-singapore',
  bundle_id TEXT,
  ram TEXT,
  cpu TEXT,
  disk TEXT,
  bandwidth TEXT,
  password_encrypted TEXT,
  password_key_version INTEGER DEFAULT 1,
  ssh_user TEXT DEFAULT 'root',
  ssh_port INTEGER DEFAULT 22,
  created_at TIMESTAMPTZ default NOW(),
  updated_at TIMESTAMPTZ default NOW()
);

-- Payments table
create table if not exists payments (
  id UUID default gen_random_uuid () primary key,
  user_id UUID references auth.users,
  server_id UUID references servers,
  reference TEXT unique,
  merchant_ref TEXT,
  amount BIGINT not null,
  status TEXT default 'pending',
  payment_method TEXT,
  checkout_url TEXT,
  paid_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ default NOW()
);

-- Enable RLS
alter table servers ENABLE row LEVEL SECURITY;

alter table payments ENABLE row LEVEL SECURITY;

-- RLS Policies for servers
create policy "Users can view own servers" on servers for
select
  using (auth.uid () = user_id);

create policy "Users can insert own servers" on servers for INSERT
with
  check (auth.uid () = user_id);

create policy "Users can update own servers" on servers
for update
  using (auth.uid () = user_id);

-- RLS Policies for payments
create policy "Users can view own payments" on payments for
select
  using (auth.uid () = user_id);

create policy "Users can insert own payments" on payments for INSERT
with
  check (auth.uid () = user_id);

-- Service role bypasses RLS automatically, no policy needed
-- Indexes
create index IF not exists idx_servers_user_id on servers (user_id);
create index IF not exists idx_payments_user_id on payments (user_id);
create index IF not exists idx_payments_reference on payments (reference);

--------------------------------------------------------------------------------
-- MIGRATIONS
--------------------------------------------------------------------------------

-- Migration: Add SSH connection fields to servers table
-- Date: 2026-03-19
-- Description: Add SSH user and port fields for direct SSH connections
--              These fields allow flexible SSH configuration per server

-- Add ssh_user column (default: root)
ALTER TABLE servers 
ADD COLUMN IF NOT EXISTS ssh_user TEXT DEFAULT 'root';

-- Add ssh_port column (default: 22)
ALTER TABLE servers 
ADD COLUMN IF NOT EXISTS ssh_port INTEGER DEFAULT 22;
