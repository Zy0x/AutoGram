-- API/relay hardening.  All changes are additive and replay-safe.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='forwarder_jobs' and column_name='idempotency_key') then
    alter table public.forwarder_jobs add column idempotency_key text;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='relay_commands' and column_name='payload_ciphertext') then
    alter table public.relay_commands add column payload_ciphertext text not null default '';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='relay_commands' and column_name='last_error') then
    alter table public.relay_commands add column last_error text;
  end if;
end $$;

create unique index if not exists idx_forwarder_jobs_idempotency
  on public.forwarder_jobs(user_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.claim_relay_command(p_device_id uuid)
returns setof public.relay_commands
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.relay_commands c
     set status='CLAIMED', claimed_at=now()
   where c.id = (
     select id from public.relay_commands
      where device_id=p_device_id and status='PENDING'
      order by created_at asc
      for update skip locked limit 1
   )
  returning c.*;
end;
$$;

revoke all on function public.claim_relay_command(uuid) from public;
grant execute on function public.claim_relay_command(uuid) to authenticated;
