create table public.credits (
  id uuid not null default gen_random_uuid (),
  user_id text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone null,
  balance bigint null,
  constraint credits_pkey primary key (id),
  constraint credits_user_id_key unique (user_id),
  constraint credits_user_id_fkey foreign KEY (user_id) references users (id)
) TABLESPACE pg_default;
