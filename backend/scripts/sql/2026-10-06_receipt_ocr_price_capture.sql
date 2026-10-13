-- 2026-10-06_receipt_ocr_price_capture.sql
--
-- Receipt-OCR price capture: staff photograph a market receipt (or upload
-- a PDF price list), the browser extracts the text (tesseract.js / pdf.js),
-- a review screen matches each line to an ingredient, and only a
-- human-confirmed save reaches the database.
--
-- This file makes three changes:
--   1. market_price.receipt_url      -> where the receipt file (photo or
--                                        PDF) that produced this price row
--                                        lives.
--   2. market_price.ocr_confidence   -> how sure the fuzzy match was (0..1),
--                                        kept so a low-confidence price can
--                                        be spotted later.
--   3. The `receipts` storage bucket + its policies, so the signed-in staff
--                                        session (not the service role) can
--                                        upload, and the public URL stored in
--                                        receipt_url keeps resolving.
--
-- Idempotent: every statement below is safe to run more than once.
--
-- ROLLBACK:
--   drop policy if exists "receipts_authenticated_insert" on storage.objects;
--   drop policy if exists "receipts_authenticated_update" on storage.objects;
--   delete from storage.buckets where id = 'receipts';
--   alter table market_price
--     drop column if exists receipt_url,
--     drop column if exists ocr_confidence;
--   (existing photo objects are removed separately from the bucket.)

-- =====================================================================
-- 1. market_price columns
-- =====================================================================
-- Table name is market_price (singular) in this schema; market_prices does
-- not exist.

alter table market_price
  add column if not exists receipt_url text,
  add column if not exists ocr_confidence numeric(4, 3);

comment on column market_price.receipt_url is
  'Public URL of the receipt file (Supabase storage bucket "receipts",
   path {ingredientId}/{timestamp}.jpg or .pdf) this price row was
   transcribed from. NULL for every manually entered price. Stored as text;
   never fetched by the server.';

comment on column market_price.ocr_confidence is
  'Fuzzy-match confidence (0..1) of the receipt line to its ingredient at
   review time. NULL for manual entries. A value below 0.6 is highlighted
   for extra scrutiny in the review screen, not rejected there.';
-- No index: these columns are only ever read alongside a row that is
-- already being returned (comparison view / trend chart).

-- =====================================================================
-- 2. the receipts bucket
-- =====================================================================
-- PUBLIC on purpose: the review screen stores getPublicUrl() output in
-- receipt_url, and a signed URL would expire while the column would keep
-- pointing at it. Uploads still require an authenticated session (policy
-- below); a public bucket only makes the OBJECTS readable by anyone who
-- already holds the unguessable path.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do update set public = true;

-- =====================================================================
-- 3. storage policies for the staff session
-- =====================================================================
-- The backend's service role bypasses RLS entirely, but receipt uploads run
-- in the browser with the user's own session, so these policies are what
-- actually allow the write.
--
-- The path is constrained to {numeric ingredient id}/{something}.jpg|.pdf so
-- a captured session token can only ever write inside ingredient folders in
-- this one bucket -- never into "files" or any other bucket.

drop policy if exists "receipts_authenticated_insert" on storage.objects;
create policy "receipts_authenticated_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] ~ '^[0-9]+$'
    and name ~* '\.(jpg|pdf)$'
  );

-- Upsert re-uploads (a retry after a partial failure re-uses the same
-- {ingredientId}/{timestamp}.jpg|.pdf path) resolve as an update in storage.
drop policy if exists "receipts_authenticated_update" on storage.objects;
create policy "receipts_authenticated_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] ~ '^[0-9]+$'
    and name ~* '\.(jpg|pdf)$'
  )
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] ~ '^[0-9]+$'
    and name ~* '\.(jpg|pdf)$'
  );

-- No SELECT policy is needed: the bucket is public, so getPublicUrl()
-- resolves without touching RLS. No DELETE policy either -- receipt files
-- are audit evidence for a price row and are not user-deletable from the UI.
