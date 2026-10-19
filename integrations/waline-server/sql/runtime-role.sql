-- Original deployment policy, not a replacement for Waline's pinned schema.
-- Run as the database owner ONLY in the dedicated comments database.
-- First create waline_app through SQL (not a Neon superuser role), then set its
-- password privately with psql \password. No password belongs in this file.
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO waline_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wl_comment, public.wl_counter, public.wl_users TO waline_app;
GRANT USAGE, SELECT ON SEQUENCE public.wl_comment_seq, public.wl_counter_seq, public.wl_users_seq TO waline_app;
COMMIT;
