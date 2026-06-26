-- Flip Lens initial schema.
-- Multi-tenant from day one: every domain row carries tenant_id + user_id so
-- that adding real auth later is a context swap, not a migration. For the MVP a
-- single default tenant/user is seeded and injected by the requireTenant stub.

create extension if not exists "pgcrypto";

create table if not exists tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now(),
  unique (tenant_id, email)
);

create index if not exists users_tenant_idx on users (tenant_id);

create table if not exists items (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  user_id           uuid not null references users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Image is stored in object storage; the DB keeps only a reference.
  thumbnail_key     text,
  thumbnail_url     text,
  -- Context metadata (cheap text) — not a substitute for the stored image.
  source_url        text,
  lens_url          text,
  title             text not null default '',
  description       text not null default '',
  resale_value      numeric,
  confidence        text not null default 'none',
  confidence_reason text not null default '',
  user_confirmed    boolean not null default false,
  price_stats       jsonb,
  market_stats      jsonb,
  comps             jsonb not null default '[]'::jsonb
);

create index if not exists items_owner_created_idx
  on items (tenant_id, user_id, created_at desc);

-- Seed the default tenant/user referenced by DEFAULT_TENANT_ID / DEFAULT_USER_ID.
insert into tenants (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Default Tenant')
on conflict (id) do nothing;

insert into users (id, tenant_id, email, display_name)
values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  'owner@local',
  'Default User'
)
on conflict (id) do nothing;

-- Groundwork note: when auth is added, enable row-level security and scope by a
-- per-request setting instead of (or in addition to) app-level WHERE clauses, e.g.
--
--   alter table items enable row level security;
--   create policy items_tenant_isolation on items
--     using (tenant_id = current_setting('app.tenant_id')::uuid);
--
-- and SET app.tenant_id from the authenticated context at the start of each tx.
