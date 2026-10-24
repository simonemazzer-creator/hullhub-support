-- HullHub 1.2: spesa IA per cliente al mese (tetto 2 $ = meno di 2 €), solo per la Edge Function ai-entry
create table if not exists public.ai_cost(
  month text not null,
  k text not null,
  usd numeric(10,5) not null default 0,
  web int not null default 0,
  n int not null default 0,
  primary key(month, k)
);
alter table public.ai_cost enable row level security;

create or replace function public.ai_cost_get(p_key text, p_month text)
returns json language sql security definer set search_path = public as $$
  select coalesce((select json_build_object('usd', usd, 'web', web, 'n', n) from ai_cost where month = p_month and k = p_key), json_build_object('usd', 0, 'web', 0, 'n', 0));
$$;

create or replace function public.ai_cost_add(p_key text, p_month text, p_usd numeric, p_web int)
returns void language sql security definer set search_path = public as $$
  insert into ai_cost(month, k, usd, web, n) values (p_month, p_key, p_usd, p_web, 1)
  on conflict (month, k) do update set usd = ai_cost.usd + excluded.usd, web = ai_cost.web + excluded.web, n = ai_cost.n + 1;
$$;

revoke all on function public.ai_cost_get(text, text) from public, anon, authenticated;
revoke all on function public.ai_cost_add(text, text, numeric, int) from public, anon, authenticated;
grant execute on function public.ai_cost_get(text, text) to service_role;
grant execute on function public.ai_cost_add(text, text, numeric, int) to service_role;

-- Riepilogo per Simone: costo medio e massimo per cliente nel mese
create or replace view public.ai_cost_mese as
  select month, count(*) as clienti, round(sum(usd)::numeric, 2) as usd_totale, round(avg(usd)::numeric, 3) as usd_medio, round(max(usd)::numeric, 3) as usd_max, sum(web) as ricerche_web, sum(n) as richieste
  from public.ai_cost group by month order by month desc;
revoke all on public.ai_cost_mese from anon, authenticated;
