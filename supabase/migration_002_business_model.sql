-- Migration 002: Business Model Classification
-- Run this in the Supabase SQL editor.
--
-- Adds business_model column to reports so every analysis records how
-- Claude classified the company before scoring. This is critical for
-- understanding whether S2 (Order Book) was evaluated with the correct
-- business-model-specific analogue.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS business_model text;

COMMENT ON COLUMN reports.business_model IS
  'Business model classification: epc | manufacturing | financial | infrastructure | services | trading | product. Determines which S2 analogue was used.';

-- Update the max_score default from 36 to 39 (the correct value after S3/S4/S10
-- were upgraded to 5 points each as primary signals).
ALTER TABLE reports
  ALTER COLUMN max_score SET DEFAULT 39;
