-- Spec §3 search: trigram matching, accent-insensitive. Both extensions ship with Postgres
-- (contrib, present in postgres:17-alpine) and are "trusted", so a database owner can create them.
-- WITH SCHEMA public: the wrapper below names public.unaccent explicitly.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;--> statement-breakpoint
-- unaccent() is only STABLE (it reads a dictionary); generated columns and index expressions need
-- IMMUTABLE. Naming the dictionary explicitly makes the result fixed, so the wrapper is safe.
CREATE OR REPLACE FUNCTION family_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
