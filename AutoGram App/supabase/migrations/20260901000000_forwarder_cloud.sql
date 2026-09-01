-- Forwarder cloud control plane. Telegram sessions, API hashes and media never
-- belong in this schema; devices keep those secrets locally.
create extension if not exists pgcrypto;

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text not null check (platform in ('desktop','android')),
  public_key text not null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.forwarder_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  schema_version integer not null default 2,
  revision bigint not null default 0,
  config_ciphertext text not null,
  status text not null default 'READY',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.job_revisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.forwarder_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null,
  config_ciphertext text not null,
  created_at timestamptz not null default now(),
  unique(job_id, revision)
);
create table if not exists public.execution_summaries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.forwarder_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null,
  processed bigint not null default 0,
  skipped bigint not null default 0,
  failed bigint not null default 0,
  last_cursor text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.event_streams (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.forwarder_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence bigint not null,
  event_ciphertext text not null,
  created_at timestamptz not null default now(),
  unique(job_id, sequence)
);
create table if not exists public.relay_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  job_id uuid references public.forwarder_jobs(id) on delete cascade,
  command text not null,
  nonce text not null,
  signature text not null,
  status text not null default 'PENDING',
  claimed_at timestamptz,
  acked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.decision_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.forwarder_jobs(id) on delete cascade,
  reason_code text not null,
  payload_ciphertext text not null,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create table if not exists public.webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  secret_hash text not null,
  events text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.api_audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  request_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists public.api_clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  key_hash text not null,
  scopes text[] not null default '{}',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.encryption_metadata (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.devices(id) on delete cascade,
  key_id text not null,
  algorithm text not null default 'AES-256-GCM',
  created_at timestamptz not null default now(),
  unique(user_id, key_id)
);

create index if not exists idx_forwarder_jobs_user_status on public.forwarder_jobs(user_id, status);
create index if not exists idx_relay_commands_claim on public.relay_commands(device_id, status, created_at);
create index if not exists idx_event_streams_job_seq on public.event_streams(job_id, sequence);

alter table public.devices enable row level security;
alter table public.forwarder_jobs enable row level security;
alter table public.job_revisions enable row level security;
alter table public.execution_summaries enable row level security;
alter table public.event_streams enable row level security;
alter table public.relay_commands enable row level security;
alter table public.decision_inbox enable row level security;
alter table public.webhook_subscriptions enable row level security;
alter table public.api_audit_logs enable row level security;
alter table public.api_clients enable row level security;
alter table public.encryption_metadata enable row level security;

create policy devices_owner on public.devices for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy jobs_owner on public.forwarder_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy revisions_owner on public.job_revisions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy executions_owner on public.execution_summaries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy events_owner on public.event_streams for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy relay_owner on public.relay_commands for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy decisions_owner on public.decision_inbox for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy webhooks_owner on public.webhook_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy audit_owner on public.api_audit_logs for select using (auth.uid() = user_id);
create policy api_clients_owner on public.api_clients for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy encryption_owner on public.encryption_metadata for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
