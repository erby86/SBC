-- M23 local accounts (ADR-0023): the IT team logs in with an email and a password stored here
-- as an argon2id hash (not a secret of another system, so ADR-0005 allows it). No password =
-- cannot log in. auth.users has no audit trigger on purpose: the change log would copy the hash;
-- account changes go to audit.user_actions instead. Roles in use: operator, admin.
ALTER TABLE auth.users ADD COLUMN password_hash text;
ALTER TABLE auth.users ADD COLUMN password_changed_at timestamptz;
ALTER TABLE auth.users ADD CONSTRAINT users_email_lower CHECK (email = lower(email)) NOT VALID;
