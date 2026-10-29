-- Original deployment policy, not a replacement for Waline's pinned schema.
-- Run as the database owner ONLY in the dedicated comments database.
-- First create waline_app through SQL (not a Neon superuser role).
-- Neon needs the original password over verified TLS; psql \password pre-hashes
-- it and cannot initialize it there. Use a private interactive client (README).
-- No password belongs in this file.
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO waline_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wl_comment, public.wl_counter, public.wl_users TO waline_app;
GRANT USAGE, SELECT ON SEQUENCE public.wl_comment_seq, public.wl_counter_seq, public.wl_users_seq TO waline_app;
COMMIT;
