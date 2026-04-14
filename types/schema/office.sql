create table public.offices (
  id uuid not null default gen_random_uuid (),
  user_id text not null,
  server_id uuid not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone null,
  expired_at timestamp with time zone null,
  constraint offices_pkey primary key (id),
  constraint offices_server_id_key unique (server_id),
  constraint offices_server_id_fkey foreign KEY (server_id) references servers (id),
  constraint offices_user_id_fkey foreign KEY (user_id) references users (id)
) TABLESPACE pg_default;
