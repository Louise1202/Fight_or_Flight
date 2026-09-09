-- A free-text note a judge can attach when a heat is force-ended (by the
-- 60-minute timeout, or a manual "End heat") while their team was still
-- mid-station - e.g. "stopped after 8 of 15 reps at station 6". Nothing
-- computes or validates this; it's purely for the race organizer's record.
alter table teams add column if not exists stopped_note text;
