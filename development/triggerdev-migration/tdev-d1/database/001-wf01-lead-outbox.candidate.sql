-- DH-TDEV-WF01 candidate only. Do not execute without separate schema/security approval.
-- This stores intake receipts/outbox state; it does not replace the existing CRM source of truth.
-- No unique constraint is proposed on identity_key: the retry/collision policy is awaiting review.

CREATE TABLE IF NOT EXISTS dh_tdev_d1_lead_candidate (
  lead_id text PRIMARY KEY CHECK (lead_id ~ '^lead_[a-f0-9]{32}$'),
  identity_key char(64) NOT NULL,
  fingerprint char(64) NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  received_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN (
    'dispatch_pending', 'dispatching', 'dispatch_accepted', 'dispatch_failed', 'dispatch_unknown',
    'processing', 'processing_retry_pending', 'processing_failed', 'processing_unknown', 'downstream_acknowledged'
  )),
  processing_attempts integer NOT NULL DEFAULT 0 CHECK (processing_attempts >= 0),
  processing_attempt_id text,
  processing_next_attempt_at timestamptz NOT NULL DEFAULT to_timestamp(0),
  processing_lease_until timestamptz NOT NULL DEFAULT to_timestamp(0),
  downstream_receipt_ref text
);

-- Deliberately non-unique: scoped idempotency is serialized with a transaction advisory lock in the adapter.
CREATE INDEX IF NOT EXISTS dh_tdev_d1_lead_identity_lookup ON dh_tdev_d1_lead_candidate(identity_key);
CREATE INDEX IF NOT EXISTS dh_tdev_d1_lead_status_recovery ON dh_tdev_d1_lead_candidate(status, processing_next_attempt_at);

CREATE TABLE IF NOT EXISTS dh_tdev_d1_outbox_candidate (
  outbox_id text PRIMARY KEY,
  lead_id text NOT NULL UNIQUE REFERENCES dh_tdev_d1_lead_candidate(lead_id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('pending', 'dispatching', 'accepted', 'failed', 'unknown', 'exhausted')),
  dispatch_attempts integer NOT NULL DEFAULT 0 CHECK (dispatch_attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT to_timestamp(0),
  lease_until timestamptz NOT NULL DEFAULT to_timestamp(0),
  active_attempt_id text,
  last_failure_code text,
  dispatch_receipt_ref text
);

CREATE INDEX IF NOT EXISTS dh_tdev_d1_outbox_recovery ON dh_tdev_d1_outbox_candidate(status, next_attempt_at, lease_until);
