-- Each scan the judge's phone submits carries a client-generated UUID.
-- If the same scan is ever submitted twice (e.g. an offline retry that
-- actually succeeded the first time, but the phone didn't get the
-- confirmation before losing signal), this constraint makes the second
-- attempt fail cleanly instead of creating a duplicate timing event.
alter table scans add column client_scan_id uuid;
alter table scans add constraint scans_client_scan_id_unique unique (client_scan_id);

-- Existing rows (if any) have no client_scan_id - that's fine, the
-- column is nullable and the unique constraint ignores nulls.
