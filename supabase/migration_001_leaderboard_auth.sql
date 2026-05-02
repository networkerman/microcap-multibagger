-- Migration 001: Leaderboard + Auth support
-- Run this in the Supabase SQL editor.

-- 1. Add session/user tracking to reports
--    session_id = anonymous browser session cookie (mmb_session)
--    triggered_by = auth.users.id if the user was logged in when they triggered analysis
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS session_id    text,
  ADD COLUMN IF NOT EXISTS triggered_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reports_session_idx    ON reports (session_id);
CREATE INDEX IF NOT EXISTS reports_triggered_idx  ON reports (triggered_by);

-- 2. User watchlist — explicit "save this stock" action
--    One row per (user, stock). Reports stay public/shared; this is just a bookmark.
CREATE TABLE IF NOT EXISTS user_watchlist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol      text NOT NULL,
  exchange    text NOT NULL,
  saved_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, symbol, exchange)
);

CREATE INDEX IF NOT EXISTS watchlist_user_idx ON user_watchlist (user_id);

-- Row-level security: users can only see/manage their own watchlist
ALTER TABLE user_watchlist ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY doesn't support IF NOT EXISTS — use DROP then CREATE for idempotency.
DROP POLICY IF EXISTS "Users can view own watchlist"   ON user_watchlist;
DROP POLICY IF EXISTS "Users can insert own watchlist" ON user_watchlist;
DROP POLICY IF EXISTS "Users can delete own watchlist" ON user_watchlist;

CREATE POLICY "Users can view own watchlist"
  ON user_watchlist FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watchlist"
  ON user_watchlist FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own watchlist"
  ON user_watchlist FOR DELETE
  USING (auth.uid() = user_id);

-- Grant table-level access to the authenticated role so RLS policies can fire.
-- (The service role used by API routes bypasses RLS entirely, but this is
--  required for any future direct-client queries from logged-in users.)
GRANT SELECT, INSERT, DELETE ON public.user_watchlist TO authenticated;

-- 3. Rate limiting log — append-only, queried by (ip, endpoint, created_at window)
CREATE TABLE IF NOT EXISTS rate_limit_log (
  ip          text NOT NULL,
  endpoint    text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_log_lookup_idx
  ON rate_limit_log (ip, endpoint, created_at DESC);

-- 4. Leaderboard view — top completed reports from the last 30 days
--    TODO: Add re-scoring logic here when token budget allows automatic refresh.
--    For now, analyses older than 30 days simply fall off the leaderboard.
CREATE OR REPLACE VIEW leaderboard AS
  SELECT
    symbol,
    exchange,
    company_name,
    total_score,
    max_score,
    band,
    analyzed_at
  FROM reports
  WHERE
    status       = 'complete'
    AND total_score IS NOT NULL
    AND analyzed_at > now() - INTERVAL '30 days'
  ORDER BY
    total_score  DESC,
    analyzed_at  DESC
  LIMIT 10;
