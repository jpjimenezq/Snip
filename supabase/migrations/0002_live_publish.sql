-- Snip fases 3 y 4: clips en vivo y publicación en redes. Ejecutar después de 0001.

-- ---------- nuevos tipos de job ----------
alter table public.jobs drop constraint if exists jobs_type_check;
alter table public.jobs add constraint jobs_type_check check (type in (
  'process_source','render_clip','generate_copy','manual_clip',
  'live_clip','publish_clip'));

-- ---------- canales en vivo que el worker graba en búfer ----------
create table if not exists public.live_watches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  url           text not null,                       -- https://kick.com/westcol, https://twitch.tv/x
  platform      text not null default 'other' check (platform in ('youtube','kick','twitch','other')),
  channel       text,
  enabled       boolean not null default true,       -- el usuario lo quiere grabar
  status        text not null default 'idle'
                check (status in ('idle','offline','recording','error')),
  buffer_s      double precision not null default 0, -- segundos disponibles en el búfer
  error         text,
  last_seen_at  timestamptz,                         -- heartbeat del worker
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, url)
);
drop trigger if exists live_watches_touch on public.live_watches;
create trigger live_watches_touch before update on public.live_watches
  for each row execute function public.touch_updated_at();
alter table public.live_watches enable row level security;
create policy "own live_watches" on public.live_watches for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- cuentas de redes conectadas (datos públicos) ----------
create table if not exists public.social_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  platform      text not null check (platform in ('youtube','tiktok','instagram','facebook')),
  external_id   text not null,          -- id del canal / usuario / página / cuenta IG
  name          text not null,          -- nombre visible
  avatar_url    text,
  status        text not null default 'connected' check (status in ('connected','expired','error')),
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, platform, external_id)
);
drop trigger if exists social_accounts_touch on public.social_accounts;
create trigger social_accounts_touch before update on public.social_accounts
  for each row execute function public.touch_updated_at();
alter table public.social_accounts enable row level security;
create policy "own social_accounts" on public.social_accounts for select using (user_id = auth.uid());
create policy "delete own social_accounts" on public.social_accounts for delete using (user_id = auth.uid());

-- ---------- tokens (secretos): sin políticas => solo service role / RPC ----------
create table if not exists public.social_tokens (
  account_id     uuid primary key references public.social_accounts(id) on delete cascade,
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz,
  scope          text,
  extra          jsonb not null default '{}'::jsonb,   -- p.ej. page_access_token, ig_user_id
  updated_at     timestamptz not null default now()
);
alter table public.social_tokens enable row level security;

-- Guardado desde las rutas OAuth de la web (con la sesión del usuario).
create or replace function public.save_social_account(
  p_platform text, p_external_id text, p_name text, p_avatar_url text,
  p_access_token text, p_refresh_token text, p_expires_at timestamptz,
  p_scope text, p_extra jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  insert into public.social_accounts (user_id, platform, external_id, name, avatar_url, status, error)
  values (auth.uid(), p_platform, p_external_id, p_name, p_avatar_url, 'connected', null)
  on conflict (user_id, platform, external_id)
  do update set name = excluded.name, avatar_url = excluded.avatar_url, status = 'connected', error = null
  returning id into v_id;

  insert into public.social_tokens (account_id, access_token, refresh_token, expires_at, scope, extra, updated_at)
  values (v_id, p_access_token, p_refresh_token, p_expires_at, p_scope, coalesce(p_extra, '{}'::jsonb), now())
  on conflict (account_id) do update set
    access_token = excluded.access_token,
    refresh_token = coalesce(excluded.refresh_token, public.social_tokens.refresh_token),
    expires_at = excluded.expires_at, scope = excluded.scope, extra = excluded.extra, updated_at = now();
  return v_id;
end $$;
revoke all on function public.save_social_account(text,text,text,text,text,text,timestamptz,text,jsonb) from public, anon;
grant execute on function public.save_social_account(text,text,text,text,text,text,timestamptz,text,jsonb) to authenticated;

-- ---------- publicaciones ----------
create table if not exists public.publications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  clip_id       uuid not null references public.clips(id) on delete cascade,
  account_id    uuid not null references public.social_accounts(id) on delete cascade,
  platform      text not null check (platform in ('youtube','tiktok','instagram','facebook')),
  status        text not null default 'queued'
                check (status in ('queued','uploading','processing','published','error')),
  progress      real not null default 0,
  title         text,          -- título/caption final usado (copias editadas)
  caption       text,
  privacy       text not null default 'public' check (privacy in ('public','unlisted','private')),
  external_id   text,
  external_url  text,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists publications_clip on public.publications(clip_id, created_at desc);
drop trigger if exists publications_touch on public.publications;
create trigger publications_touch before update on public.publications
  for each row execute function public.touch_updated_at();
alter table public.publications enable row level security;
create policy "own publications" on public.publications for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter publication supabase_realtime add table public.live_watches, public.publications, public.social_accounts;
