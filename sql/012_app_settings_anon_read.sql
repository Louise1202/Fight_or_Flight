-- The admin page isn't logged in via Supabase Auth at all (it's a
-- separate password cookie), so its browser client is always "anon" as
-- far as Supabase RLS is concerned. The read policy from 011 only
-- covered "authenticated" (judges, team viewers) - meaning the admin's
-- own browser could never even receive the Realtime echo of its own
-- theme change. Adding anon read access here too, since this is still
-- just a cosmetic setting, nothing sensitive.
create policy "anon can read app settings"
on app_settings for select
to anon
using (true);
