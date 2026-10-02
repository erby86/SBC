-- Roles from schema v1.1 "สิทธิ์" section. Created NOLOGIN; passwords/LOGIN are set
-- outside the repo (ADR-0005), e.g. ALTER ROLE noc_app LOGIN PASSWORD '...';
--   noc_migrate: owns schemas, used for migrations
--   noc_app:     api/worker read/write tables, no DDL
--   noc_read:    Metabase / Grafana / other systems, read the api schema only
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'noc_migrate') THEN CREATE ROLE noc_migrate NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'noc_app')     THEN CREATE ROLE noc_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'noc_read')    THEN CREATE ROLE noc_read NOLOGIN; END IF;
END $$;

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['core','catalog','asset','net','viz','auth','ops','sync','audit','api'] LOOP
    EXECUTE format('GRANT ALL ON SCHEMA %I TO noc_migrate', s);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO noc_app', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO noc_app', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO noc_app', s);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO noc_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO noc_app', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO noc_app', s);
  END LOOP;
END $$;

-- audit history is append-only for the application
REVOKE UPDATE, DELETE ON audit.change_log, audit.user_actions FROM noc_app;

GRANT USAGE ON SCHEMA api TO noc_read;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO noc_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA api GRANT SELECT ON TABLES TO noc_read;
