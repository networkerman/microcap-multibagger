-- Instruments master (synced from Kite API daily)
create table if not exists instruments (
  id                    bigserial primary key,
  symbol                text not null,
  name                  text not null,
  exchange              text not null,  -- 'NSE' | 'BSE'
  isin                  text,
  instrument_token      bigint,
  exchange_token        bigint,
  segment               text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),
  unique (symbol, exchange)
);

create index if not exists instruments_name_idx on instruments using gin (to_tsvector('english', name));
create index if not exists instruments_symbol_idx on instruments (symbol);

-- Analysis reports
create table if not exists reports (
  id                uuid primary key default gen_random_uuid(),
  symbol            text not null,
  exchange          text not null,
  company_name      text not null,
  status            text not null default 'pending',  -- pending | analyzing | complete | failed
  total_score       integer,
  max_score         integer default 36,
  band              text,   -- STRONG BUY | WATCHLIST | INVESTIGATE | AVOID
  summary           text,
  analyzed_at       timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz default now(),
  unique (symbol, exchange)
);

create index if not exists reports_symbol_idx on reports (symbol, exchange);
create index if not exists reports_expires_idx on reports (expires_at);

-- Per-signal scores within a report
create table if not exists report_signals (
  id          bigserial primary key,
  report_id   uuid references reports(id) on delete cascade,
  signal_id   text not null,   -- S1..S12
  label       text not null,
  score       integer not null,
  max_score   integer not null,
  reasoning   text,
  sources     text[],
  created_at  timestamptz default now()
);

create index if not exists report_signals_report_idx on report_signals (report_id);

-- Notification queue
create table if not exists notification_requests (
  id            bigserial primary key,
  report_id     uuid references reports(id) on delete cascade,
  email         text,
  notified_at   timestamptz,
  created_at    timestamptz default now()
);

create index if not exists notif_report_idx on notification_requests (report_id);
