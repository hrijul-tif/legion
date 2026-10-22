-- Defense in depth: Supabase's default privileges grant authenticated/anon full DML on public tables.
-- RLS already blocks those writes (0 rows), but clients should get a hard "permission denied" instead.
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on public.review_comments, public.runs, public.test_records to authenticated;

-- Keep it that way for tables created later by migrations run as postgres.
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;
