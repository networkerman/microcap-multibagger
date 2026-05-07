-- Deep analysis results (15-question Safal Niveshak framework via DeepSeek)
create table if not exists deep_analyses (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid references reports(id) on delete cascade,
  symbol        text not null,
  exchange      text not null,
  company_name  text not null,
  questions     jsonb not null default '[]',
  overall_verdict text,
  payment_id    text,           -- Razorpay payment_id after successful payment
  created_at    timestamptz default now()
);

create index if not exists deep_analyses_report_idx on deep_analyses (report_id);
create index if not exists deep_analyses_symbol_idx on deep_analyses (symbol, exchange);

-- Payments log
create table if not exists payments (
  id                  uuid primary key default gen_random_uuid(),
  razorpay_order_id   text not null,
  razorpay_payment_id text,
  razorpay_signature  text,
  amount_paise        integer not null,
  currency            text default 'INR',
  purpose             text,     -- 'deep_analysis'
  report_id           uuid references reports(id) on delete set null,
  status              text default 'created',  -- created | paid | failed
  created_at          timestamptz default now(),
  paid_at             timestamptz
);

create index if not exists payments_order_idx on payments (razorpay_order_id);
