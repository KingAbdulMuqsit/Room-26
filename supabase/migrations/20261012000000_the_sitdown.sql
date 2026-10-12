-- Room 26: add "The Sitdown" category (stored as 'sitdown').
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
-- Requires the second-category update (20260930000000_second_category.sql) to have been run first.

alter table public.posts drop constraint if exists posts_type_check;
alter table public.posts add constraint posts_type_check
  check (type in ('news','reviews','features','interviews','culture','sitdown'));

alter table public.posts drop constraint if exists posts_type2_check;
alter table public.posts add constraint posts_type2_check
  check (type2 is null or (type2 in ('news','reviews','features','interviews','culture','sitdown') and type2 <> type));

notify pgrst, 'reload schema';
