-- ===========================================================================
-- Close the cross-tenant read holes, and let client code address storage by
-- tenant SLUG instead of by business_id.
--
-- Until now most tenant tables carried a `*_select_public` policy with a
-- `USING (true)` qualifier: any anon key could read every business' products,
-- expenses, payouts and invoices. That is what forced client code to filter by
-- business_id in the first place. With reads scoped to the caller's own
-- business, the client no longer needs the id — and no longer gets one.
--
-- Anonymous storefront reads are NOT affected: they go through Edge Functions
-- that use the service role and scope by the host-resolved business_id.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.current_user_tenant_slug()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT bd.domain
    FROM public.business_domains bd
   WHERE bd.business_id = public.current_user_business_id()
     AND bd.is_primary
   LIMIT 1
$function$;

GRANT EXECUTE ON FUNCTION public.current_user_tenant_slug() TO authenticated, service_role;

DROP POLICY IF EXISTS "public read business_domains" ON public.business_domains;

DROP POLICY IF EXISTS business_domains_platform_admin_all ON public.business_domains;
CREATE POLICY business_domains_platform_admin_all ON public.business_domains
  FOR ALL TO authenticated
  USING (public.current_user_is_platform_admin())
  WITH CHECK (public.current_user_is_platform_admin());

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.tablename AS tbl, p.policyname AS pol
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.cmd = 'SELECT'
       AND p.qual = 'true'
       AND p.policyname LIKE '%_select_public'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = p.tablename
            AND c.column_name = 'business_id'
       )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pol, r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (business_id = public.current_user_business_id())',
      replace(r.pol, '_select_public', '_select_own'), r.tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS product_ingredients_select_public ON public.product_ingredients;
DROP POLICY IF EXISTS product_ingredients_select_own ON public.product_ingredients;
CREATE POLICY product_ingredients_select_own ON public.product_ingredients
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
       WHERE p.product_id = product_ingredients.product_id
         AND p.business_id = public.current_user_business_id()
    )
  );

-- Storage: new uploads land under "<slug>/…"; reads/deletes still accept the
-- legacy "<business_id>/…" prefix so existing files stay reachable.
DO $$
DECLARE
  b record;
BEGIN
  FOR b IN
    SELECT * FROM (VALUES
      ('expense-files',         'expense_files'),
      ('inventory-entry-files', 'inventory_entry_files'),
      ('scans',                 'scans_files'),
      ('trace-invoice-files',   'trace_invoice_files')
    ) AS t(bucket, prefix)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', b.prefix || '_select_own');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', b.prefix || '_insert_own');
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', b.prefix || '_delete_own');

    EXECUTE format($p$
      CREATE POLICY %I ON storage.objects FOR SELECT TO authenticated
        USING (
          bucket_id = %L AND (
            (storage.foldername(name))[1] = public.current_user_tenant_slug()
            OR (storage.foldername(name))[1] = (public.current_user_business_id())::text
          )
        )$p$, b.prefix || '_select_own', b.bucket);

    EXECUTE format($p$
      CREATE POLICY %I ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = %L
          AND (storage.foldername(name))[1] = public.current_user_tenant_slug()
        )$p$, b.prefix || '_insert_own', b.bucket);

    EXECUTE format($p$
      CREATE POLICY %I ON storage.objects FOR DELETE TO authenticated
        USING (
          bucket_id = %L AND (
            (storage.foldername(name))[1] = public.current_user_tenant_slug()
            OR (storage.foldername(name))[1] = (public.current_user_business_id())::text
          )
        )$p$, b.prefix || '_delete_own', b.bucket);
  END LOOP;
END $$;

-- The caller no longer has to name its own business.
CREATE OR REPLACE FUNCTION public.adjust_word_of_mouth_bottles(p_id uuid, p_delta integer)
 RETURNS word_of_mouth
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.word_of_mouth
     SET bottles = greatest(0, bottles + p_delta),
         updated_at = current_timestamp
   WHERE id = p_id
     AND business_id = public.current_user_business_id()
     AND deleted = false
  RETURNING *;
$function$;

GRANT EXECUTE ON FUNCTION public.adjust_word_of_mouth_bottles(uuid, integer) TO authenticated;
