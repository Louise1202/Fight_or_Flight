-- Wave/heat start times move from being a static config value to a real
-- event: scheduled_start is the plan, actual_start is null until the
-- admin actually presses "Start Heat N" on race day. Every timing
-- calculation for a team in that wave uses actual_start, not the
-- schedule - so results are based on when the heat really began, and
-- nothing can be timed before the admin has actually started it.
create table waves (
  wave_number int primary key,
  scheduled_start timestamptz,
  actual_start timestamptz
);

insert into waves (wave_number, scheduled_start, actual_start) values
  (1, '2026-09-19 07:30:00+02', null),
  (2, '2026-09-19 07:45:00+02', null),
  (3, '2026-09-19 08:30:00+02', null),
  (4, '2026-09-19 08:45:00+02', null);

alter table waves enable row level security;

-- Not sensitive data (just start times), but still limited to logged-in
-- judges/team viewers rather than made fully public, consistent with the
-- rest of the schema's access model.
create policy "any authenticated user can view waves"
on waves for select
using (auth.uid() is not null);
