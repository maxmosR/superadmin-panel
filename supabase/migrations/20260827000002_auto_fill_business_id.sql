-- ===========================================================================
-- Client code must no longer know its own business_id. Any INSERT that omits
-- business_id gets it filled from the caller's profile, server-side.
-- Inserts that DO pass a business_id (service-role / Edge Functions) are left
-- untouched — RLS WITH CHECK still constrains authenticated callers.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.set_business_id_from_caller()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_business_id uuid;
BEGIN
  IF NEW.business_id IS NULL THEN
    SELECT business_id INTO v_business_id
      FROM public.profiles
     WHERE user_id = auth.uid();

    IF v_business_id IS NULL THEN
      RAISE EXCEPTION 'business_id could not be resolved for the current caller'
        USING ERRCODE = '42501';
    END IF;

    NEW.business_id := v_business_id;
  END IF;

  RETURN NEW;
END;
$function$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col
        ON col.table_schema = 'public'
       AND col.table_name = c.relname
       AND col.column_name = 'business_id'
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname NOT IN ('businesses', 'business_domains', 'profiles')
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_business_id_from_caller ON public.%I', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER set_business_id_from_caller
         BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.set_business_id_from_caller()', r.tbl);
  END LOOP;
END $$;
