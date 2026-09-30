-- Room 26: optional second category for a post.
-- The post shows on its main category's page and on this one too.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

alter table public.posts
  add column if not exists type2 text;

alter table public.posts
  drop constraint if exists posts_type2_check;

alter table public.posts
  add constraint posts_type2_check
  check (type2 is null or (type2 in ('news','reviews','features','interviews','culture') and type2 <> type));

create index if not exists posts_type2_idx on public.posts (type2) where type2 is not null;

-- Make the API notice the new column straight away
notify pgrst, 'reload schema';
