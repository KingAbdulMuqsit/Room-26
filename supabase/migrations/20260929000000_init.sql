-- Room 26: schema, row-level security and storage.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run (or `supabase db push`).

-- ---------------------------------------------------------------
-- Admins: who may manage the site. Rows are created by the
-- invite-admin Edge Function (or the bootstrap snippet in README).
-- ---------------------------------------------------------------
create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  invited_by  uuid references auth.users(id) on delete set null,
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz
);

-- security definer so policies can call it without recursing through admins' own RLS
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Called by the site after an invited admin signs in for the first time
create or replace function public.claim_admin()
returns void
language sql security definer set search_path = public
as $$
  update public.admins set accepted_at = now()
  where user_id = auth.uid() and accepted_at is null;
$$;

-- ---------------------------------------------------------------
-- Posts: articles, album reviews, news, interviews, culture
-- ---------------------------------------------------------------
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('news','reviews','features','interviews','culture')),
  status       text not null default 'draft' check (status in ('draft','published')),
  title        text not null check (length(title) between 1 and 300),
  dek          text not null default '',
  author       text not null default '',
  body         text not null default '',
  tone         text not null default 'stone' check (tone in ('stone','clay','slate','sand','fog','char')),
  cover_path   text,
  featured     boolean not null default false,
  review       jsonb,           -- {artist, album, label, year, score}
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);
create index if not exists posts_public_idx on public.posts (status, published_at desc);

create or replace function public.posts_before_write()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.status = 'draft' then
    new.featured := false;
  end if;
  return new;
end $$;
drop trigger if exists posts_before_write on public.posts;
create trigger posts_before_write before insert or update on public.posts
for each row execute function public.posts_before_write();

-- Only one lead story at a time
create or replace function public.posts_single_lead()
returns trigger language plpgsql as $$
begin
  if new.featured then
    update public.posts set featured = false where featured and id <> new.id;
  end if;
  return null;
end $$;
drop trigger if exists posts_single_lead on public.posts;
create trigger posts_single_lead after insert or update of featured on public.posts
for each row when (new.featured) execute function public.posts_single_lead();

-- ---------------------------------------------------------------
-- Media library (files live in the "media" storage bucket)
-- ---------------------------------------------------------------
create table if not exists public.media (
  id          uuid primary key default gen_random_uuid(),
  path        text not null unique,
  name        text not null,
  size        bigint not null default 0,
  mime        text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references auth.users(id) on delete set null
);

-- ---------------------------------------------------------------
-- Site settings: a single row
-- ---------------------------------------------------------------
create table if not exists public.site_settings (
  id           int primary key default 1 check (id = 1),
  tagline      text not null default 'Records, rooms and the people who fill them.',
  strip        text not null default 'Music · Culture · News',
  footer       text not null default 'An independent media company. Reviews, reporting and long reads.',
  announcement text not null default '',
  updated_at   timestamptz not null default now()
);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------
alter table public.admins        enable row level security;
alter table public.posts         enable row level security;
alter table public.media         enable row level security;
alter table public.site_settings enable row level security;

-- posts: everyone reads published; admins read and write everything
drop policy if exists "read published posts" on public.posts;
create policy "read published posts" on public.posts for select
  using (status = 'published' or public.is_admin());
drop policy if exists "admins insert posts" on public.posts;
create policy "admins insert posts" on public.posts for insert to authenticated with check (public.is_admin());
drop policy if exists "admins update posts" on public.posts;
create policy "admins update posts" on public.posts for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete posts" on public.posts;
create policy "admins delete posts" on public.posts for delete to authenticated using (public.is_admin());

-- settings: everyone reads; admins update
drop policy if exists "read settings" on public.site_settings;
create policy "read settings" on public.site_settings for select using (true);
drop policy if exists "admins update settings" on public.site_settings;
create policy "admins update settings" on public.site_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- media library rows: admins only (the image files themselves are public)
drop policy if exists "admins manage media" on public.media;
create policy "admins manage media" on public.media for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- admins: admins see the team and can remove others (never themselves).
-- New admins are added by the invite-admin Edge Function with the service role.
drop policy if exists "admins read team" on public.admins;
create policy "admins read team" on public.admins for select to authenticated using (public.is_admin());
drop policy if exists "admins remove others" on public.admins;
create policy "admins remove others" on public.admins for delete to authenticated using (public.is_admin() and user_id <> auth.uid());

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.claim_admin() to authenticated;

-- ---------------------------------------------------------------
-- Storage: public "media" bucket, writable by admins only
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 20971520, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admins upload media" on storage.objects;
create policy "admins upload media" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.is_admin());
drop policy if exists "admins update media" on storage.objects;
create policy "admins update media" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.is_admin());
drop policy if exists "admins delete media" on storage.objects;
create policy "admins delete media" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());
