-- A penalty logged with no signal waits on the judge's phone and is sent
-- later. Like scans, each one carries an id made on the phone, so a resend
-- of a penalty that already arrived can never log it twice.
--
-- Only adds a column and an index. Existing penalties keep an empty id.
-- Nothing is deleted. Safe to run more than once.

begin;

alter table penalties add column if not exists client_penalty_id uuid;
create unique index if not exists penalties_client_penalty_id_key
  on penalties (client_penalty_id);

commit;
