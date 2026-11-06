-- Explicit operator installation on the SAME database as public.memories and pilot_memories.
CREATE SCHEMA IF NOT EXISTS memory_migration;
REVOKE ALL ON SCHEMA memory_migration FROM PUBLIC;
CREATE TABLE IF NOT EXISTS memory_migration.entries (
  id text PRIMARY KEY,
  guild_id text NOT NULL,
  channel_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('backed_up','imported','rolled_back','forgotten')),
  payload jsonb,
  target_hash text,
  CHECK ((state='forgotten') = (payload IS NULL))
);
CREATE OR REPLACE FUNCTION memory_migration.forget_copy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.origin='legacy_import' THEN
    UPDATE memory_migration.entries SET state='forgotten',payload=NULL,target_hash=NULL
      WHERE id=OLD.legacy_id AND state='imported';
    IF FOUND THEN
      DELETE FROM public.memories WHERE id::text=OLD.legacy_id;
    END IF;
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS migration_forget ON public.pilot_memories;
CREATE TRIGGER migration_forget AFTER DELETE ON public.pilot_memories
  FOR EACH ROW EXECUTE FUNCTION memory_migration.forget_copy();
CREATE OR REPLACE FUNCTION memory_migration.guard_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM memory_migration.entries WHERE lower(id)=lower(NEW.id::text)
    AND state IN ('imported','forgotten')) THEN
    RAISE EXCEPTION 'Legacy identity retired';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS migration_source_guard ON public.memories;
CREATE TRIGGER migration_source_guard BEFORE INSERT OR UPDATE ON public.memories
  FOR EACH ROW EXECUTE FUNCTION memory_migration.guard_source();
