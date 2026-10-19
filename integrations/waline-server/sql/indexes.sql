-- Run once after the pinned upstream schema, not after restoring its archive.
BEGIN;
CREATE INDEX wl_comment_article_status_time ON public.wl_comment (url, status, insertedat DESC);
CREATE INDEX wl_comment_ip_time ON public.wl_comment (ip, insertedat DESC);
CREATE INDEX wl_comment_reply_root ON public.wl_comment (rid);
-- This deployment deliberately has exactly one author account. An application
-- count() check is not atomic across Vercel instances or simultaneous requests.
CREATE UNIQUE INDEX wl_users_single_account ON public.wl_users ((true));
COMMIT;
