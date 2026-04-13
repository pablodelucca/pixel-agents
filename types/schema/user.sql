create table public.users (
  id text not null,
  created_at timestamp with time zone not null default now(),
  name text null,
  email text null,
  phone text null,
  constraint users_pkey primary key (id)
) TABLESPACE pg_default;
