-- Ensure live databases created before neural_tags existed have the column expected by the app.
-- The initial schema now includes this column, but existing deployments may be missing it.
alter table public.posts
  add column if not exists neural_tags text[] not null default '{}';
