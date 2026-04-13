create table public.servers (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone null,
  cpu smallint null,
  ram smallint null,
  storage smallint null,
  ip_public text null,
  ip_private text null,
  username text null,
  password text null,
  status character varying null,
  constraint servers_pkey primary key (id)
) TABLESPACE pg_default;
