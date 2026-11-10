-- Least privilege for the API (spec §8, decision 12). Idempotent: runs at the first start
-- (docker-entrypoint-initdb.d) and again after every restore (docker/backup/restore.sh).
REVOKE ALL ON DATABASE family FROM PUBLIC;
GRANT CONNECT ON DATABASE family TO family_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO family_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO family_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO family_app;
-- Tables the migrations create later (as family_owner) get the same rights automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE family_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO family_app;
ALTER DEFAULT PRIVILEGES FOR ROLE family_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO family_app;
