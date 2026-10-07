-- 1) The second athlete can sign later, on their own phone.
-- 2) The organiser's full registration form (wording v2, 2026-10-07).
--
-- Athlete 1 signs up the team and signs. If athlete 2 isn't with them,
-- athlete 1 only gives athlete 2's name, phone and email; athlete 2 gets
-- an email link and fills in everything else and signs themselves.
--
--   status 'registered' = spot booked (waiting for a signature)
--   status 'confirmed'  = every athlete has signed (set automatically)
--
-- POPIA: ID/passport number, home address and date of birth are erased
-- 30 days after the event, together with the medical answers.
--
-- Nothing is deleted. Safe to run more than once. One transaction.

begin;

-- ---------------------------------------------------------------------
-- 1. New questions from the organiser's form
-- ---------------------------------------------------------------------
alter table team_members add column if not exists preferred_name text;
alter table team_members add column if not exists date_of_birth date;
alter table team_members add column if not exists id_number text;
alter table team_members add column if not exists address text;
alter table team_members add column if not exists country text;
alter table team_members add column if not exists emergency_phone_alt text;
alter table team_members add column if not exists emergency_aware boolean;
alter table team_members add column if not exists photo_consent boolean;
alter table team_members add column if not exists legal_name text;
alter table team_members add column if not exists erase_after date;

-- Per-question details, medical aid and doctor (health information:
-- erased with the rest of member_medical).
alter table member_medical add column if not exists extra jsonb;

-- ---------------------------------------------------------------------
-- 2. A member who hasn't signed yet has no emergency contact, consents,
--    signature or signing time. Once signed, emergency contact and
--    consents are required here; the signature itself is checked by the
--    server (older test rows have none).
-- ---------------------------------------------------------------------
alter table team_members alter column emergency_name drop not null;
alter table team_members alter column emergency_phone drop not null;
alter table team_members alter column consents drop not null;
alter table team_members alter column signed_at drop not null;

alter table team_members drop constraint if exists team_members_signed_complete;
alter table team_members add constraint team_members_signed_complete check (
  signed_at is null
  or (emergency_name is not null and emergency_phone is not null and consents is not null)
);

-- ---------------------------------------------------------------------
-- 3. Writes the athlete's own answers onto their member row (shared by
--    sign-up and the second athlete signing later).
-- ---------------------------------------------------------------------
create or replace function apply_member_answers(p_member_id bigint, m jsonb, p_event_date date)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update team_members set
    preferred_name = nullif(m->>'preferred_name', ''),
    date_of_birth = nullif(m->>'date_of_birth', '')::date,
    id_number = nullif(m->>'id_number', ''),
    address = nullif(m->>'address', ''),
    country = nullif(m->>'country', ''),
    emergency_name = m->>'emergency_name',
    emergency_phone = m->>'emergency_phone',
    emergency_relationship = nullif(m->>'emergency_relationship', ''),
    emergency_phone_alt = nullif(m->>'emergency_phone_alt', ''),
    emergency_aware = (m->>'emergency_aware')::boolean,
    photo_consent = (m->>'photo_consent')::boolean,
    legal_name = nullif(m->>'legal_name', ''),
    consents = m->'consents',
    signature_png = m->>'signature_png',
    signed_at = now(),
    erase_after = p_event_date + 30
  where id = p_member_id;

  insert into member_medical (member_id, answers, details, extra, erase_after)
  values (p_member_id, coalesce(m->'medical', '{}'::jsonb), nullif(m->>'medical_details', ''),
          m->'medical_extra', p_event_date + 30)
  on conflict (member_id) do update
    set answers = excluded.answers, details = excluded.details, extra = excluded.extra,
        erase_after = excluded.erase_after;
end;
$$;
revoke all on function apply_member_answers(bigint, jsonb, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Sign-up. A member marked "pending" is stored with only name,
--    gender, phone and email. The team is confirmed straight away only
--    when nobody is pending.
-- ---------------------------------------------------------------------
create or replace function register_team(p_event_id text, p_team jsonb, p_members jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  ev events%rowtype;
  new_id text;
  m jsonb;
  member_id bigint;
  team_name text;
  any_pending boolean := false;
begin
  select * into ev from events where id = p_event_id for update;
  if ev.id is null then raise exception 'NO_SUCH_EVENT' using errcode = 'RT010'; end if;
  if not ev.registration_open or ev.locked then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'RT011';
  end if;
  if ev.team_id_scheme <> 'sequential' then
    raise exception 'REGISTRATION_NOT_SUPPORTED' using errcode = 'RT012';
  end if;

  new_id := ev.team_id_prefix || lpad(ev.next_team_number::text, 3, '0');
  update events set next_team_number = next_team_number + 1 where id = ev.id;

  team_name := nullif(trim(p_team->>'team_name'), '');
  if team_name is null then team_name := 'Team ' || new_id; end if;

  select coalesce(bool_or(coalesce((x->>'pending')::boolean, false)), false)
    into any_pending from jsonb_array_elements(p_members) x;

  insert into teams (id, event_id, team_name, athlete_1, athlete_2, division, wave, start_time,
                     status, registered_at)
  values (
    new_id, ev.id, team_name,
    (p_members->0->>'first_name') || ' ' || (p_members->0->>'surname'),
    (p_members->1->>'first_name') || ' ' || (p_members->1->>'surname'),
    p_team->>'division', null, ev.event_date::timestamptz,
    case when any_pending then 'registered' else 'confirmed' end, now()
  );

  for m in select * from jsonb_array_elements(p_members) loop
    insert into team_members (team_id, position, first_name, surname, gender, phone, email, signed_at)
    values (new_id, (m->>'position')::smallint, m->>'first_name', m->>'surname', m->>'gender',
            m->>'phone', m->>'email', null)
    returning id into member_id;

    if not coalesce((m->>'pending')::boolean, false) then
      perform apply_member_answers(member_id, m, ev.event_date);
    end if;
  end loop;

  return new_id;
end;
$$;
revoke all on function register_team(text, jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. The second athlete signs later. Returns the team's new status.
--    Refused if the event is locked, the team is withdrawn, or this
--    athlete has already signed.
-- ---------------------------------------------------------------------
create or replace function sign_team_member(p_team_id text, p_position smallint, p_member jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  t teams%rowtype;
  ev events%rowtype;
  mem team_members%rowtype;
  new_status text;
begin
  select * into t from teams where id = p_team_id for update;
  if t.id is null then raise exception 'NO_SUCH_TEAM' using errcode = 'RT013'; end if;
  select * into ev from events where id = t.event_id;
  if ev.locked then raise exception 'EVENT_LOCKED' using errcode = 'RT001'; end if;
  if t.status = 'withdrawn' then raise exception 'TEAM_WITHDRAWN' using errcode = 'RT014'; end if;

  select * into mem from team_members where team_id = p_team_id and position = p_position for update;
  if mem.id is null then raise exception 'NO_SUCH_TEAM' using errcode = 'RT013'; end if;
  if mem.signed_at is not null then raise exception 'ALREADY_SIGNED' using errcode = 'RT015'; end if;

  perform apply_member_answers(mem.id, p_member, ev.event_date);

  new_status := t.status;
  if t.status = 'registered'
     and not exists (select 1 from team_members where team_id = p_team_id and signed_at is null) then
    update teams set status = 'confirmed' where id = p_team_id;
    new_status := 'confirmed';
  end if;
  return new_status;
end;
$$;
revoke all on function sign_team_member(text, smallint, jsonb) from public, anon, authenticated;
grant execute on function sign_team_member(text, smallint, jsonb) to service_role;

commit;

-- ---------------------------------------------------------------------
-- 6. Daily clean-up, now also erasing ID numbers, addresses and dates of
--    birth 30 days after the event (outside the transaction: pg_cron).
--    Scheduling under the same name replaces the existing job.
-- ---------------------------------------------------------------------
select cron.schedule(
  'erase-medical-and-rate-limits',
  '15 0 * * *',
  $$delete from public.member_medical where erase_after < current_date;
    update public.team_members set id_number = null, address = null, date_of_birth = null
      where erase_after < current_date and (id_number is not null or address is not null or date_of_birth is not null);
    delete from public.rate_limits where window_start < now() - interval '2 days';$$
);
