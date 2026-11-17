-- Snip: esquema inicial. Ejecutar en Supabase > SQL Editor.

create extension if not exists "pgcrypto";

-- ---------- sources ----------
create table if not exists public.sources (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  url           text not null,
  platform      text not null default 'other'
                check (platform in ('youtube','kick','twitch','other')),
  title         text,
  channel       text,
  duration_s    double precision,
  status        text not null default 'queued'
                check (status in ('queued','downloading','transcribing','analyzing','ready','error')),
  progress      real not null default 0,          -- 0..1 dentro del estado actual
  error         text,
  local_path    text,                              -- ruta en el PC del worker
  thumb_path    text,                              -- key en Storage
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sources_user_created on public.sources(user_id, created_at desc);

-- ---------- transcripts ----------
create table if not exists public.transcripts (
  source_id     uuid primary key references public.sources(id) on delete cascade,
  language      text,
  text          text not null default '',
  segments      jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

-- ---------- clips ----------
create table if not exists public.clips (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid not null references public.sources(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  origin          text not null default 'ai' check (origin in ('ai','manual','hotkey')),
  start_s         double precision not null,
  end_s           double precision not null check (end_s > start_s),
  title           text,
  hook            text,          -- frase gancho / por qué engancha
  reason          text,          -- explicación de la IA
  score           integer check (score between 0 and 100),
  layout          jsonb,         -- ver docs/ARCHITECTURE.md
  subtitle_style  text not null default 'karaoke' check (subtitle_style in ('karaoke','simple','none')),
  status          text not null default 'suggested'
                  check (status in ('suggested','queued_render','rendering','rendered','error')),
  progress        real not null default 0,
  error           text,
  frame_path      text,
  preview_path    text,
  output_path     text,
  copies          jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists clips_source on public.clips(source_id, score desc nulls last);
create index if not exists clips_user_created on public.clips(user_id, created_at desc);

-- ---------- jobs ----------
create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in ('process_source','render_clip','generate_copy','manual_clip')),
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending' check (status in ('pending','running','done','error')),
  attempts    integer not null default 0,
  error       text,
  worker_id   text,
  locked_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists jobs_pending on public.jobs(status, created_at) where status = 'pending';

-- ---------- updated_at ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists sources_touch on public.sources;
create trigger sources_touch before update on public.sources
  for each row execute function public.touch_updated_at();
drop trigger if exists clips_touch on public.clips;
create trigger clips_touch before update on public.clips
  for each row execute function public.touch_updated_at();
drop trigger if exists jobs_touch on public.jobs;
create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();

-- ---------- claim_job: el worker toma el siguiente job pendiente ----------
-- Recupera también jobs 'running' abandonados hace más de 2 horas.
create or replace function public.claim_job(p_worker_id text)
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.jobs j
     set status = 'running', worker_id = p_worker_id, locked_at = now(), attempts = j.attempts + 1
   where j.id = (
     select id from public.jobs
      where status = 'pending'
         or (status = 'running' and locked_at < now() - interval '2 hours')
      order by created_at
      for update skip locked
      limit 1)
  returning j.*;
end $$;
revoke all on function public.claim_job(text) from public, anon, authenticated;
grant execute on function public.claim_job(text) to service_role;

-- ---------- RLS: cada usuario solo ve lo suyo (el worker usa service role) ----------
alter table public.sources     enable row level security;
alter table public.transcripts enable row level security;
alter table public.clips       enable row level security;
alter table public.jobs        enable row level security;

create policy "own sources" on public.sources for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own clips" on public.clips for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own jobs" on public.jobs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own transcripts" on public.transcripts for select
  using (exists (select 1 from public.sources s where s.id = source_id and s.user_id = auth.uid()));

-- ---------- Realtime para ver el progreso en vivo ----------
alter publication supabase_realtime add table public.sources, public.clips, public.jobs;

-- ---------- Storage ----------
insert into storage.buckets (id, name, public)
values ('clips', 'clips', false)
on conflict (id) do nothing;

create policy "authenticated read clips" on storage.objects for select
  to authenticated using (bucket_id = 'clips');
