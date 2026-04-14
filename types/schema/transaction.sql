create table public.transactions (
  id uuid not null default gen_random_uuid (),
  user_id text not null,
  payment_id uuid null,
  office_id uuid null,
  created_at timestamp with time zone not null default now(),
  type character varying null,
  amount bigint null,
  "desc" text null,
  constraint transactions_pkey primary key (id),
  constraint transactions_office_id_fkey foreign KEY (office_id) references offices (id),
  constraint transactions_payment_id_fkey foreign KEY (payment_id) references payments (id),
  constraint transactions_user_id_fkey foreign KEY (user_id) references users (id)
) TABLESPACE pg_default;
