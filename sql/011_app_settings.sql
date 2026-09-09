-- A single shared setting so the admin's light/dark choice propagates
-- live to every judge's phone too, not just the admin's own device.
-- Always exactly one row (id = 1) - this is a singleton, not a
-- per-user preference store.
create table if not exists app_settings (
  id int primary key default 1,
  theme text not null default 'dark' check (theme in ('dark', 'light')),
  constraint app_settings_singleton check (id = 1)
);

insert into app_settings (id, theme) values (1, 'dark')
on conflict (id) do nothing;

alter table app_settings enable row level security;

-- Read-only for anyone logged in (judges, team viewers) - it's a
-- cosmetic setting, nothing sensitive. Writes only ever go through the
-- admin API route using the service role, so no insert/update policy is
-- added here - RLS denies those by default.
create policy "anyone authenticated can read app settings"
on app_settings for select
to authenticated
using (true);
