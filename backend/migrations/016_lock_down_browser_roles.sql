-- 016_lock_down_browser_roles.sql
-- Purpose: the browser key (anon) must not read or write any table.
-- Only the backend service-role key reaches the data.

-- 1. Remove the over-permissive policies
drop policy if exists "transactions_select" on <table>;
drop policy if exists "transactions_insert" on <table>;
drop policy if exists "categories_select" on <table>;
drop policy if exists "categories_insert" on <table>;
drop policy if exists "Allow read for all" on <table>;
drop policy if exists "audit_logs_select_authenticated" on <table>;

-- 2. Remove table and sequence permissions from the browser roles
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;