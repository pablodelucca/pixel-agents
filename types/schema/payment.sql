create table public.payments (
  id uuid not null default gen_random_uuid (),
  user_id text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone null,
  amount bigint null,
  status character varying null,
  url text null,
  metadata jsonb null,
  constraint payments_pkey primary key (id),
  constraint payments_user_id_fkey foreign KEY (user_id) references users (id)
) TABLESPACE pg_default;
