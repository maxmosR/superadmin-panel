-- ===========================================================================
-- Multi-domain tenancy + server-side host -> business_id resolution
--
-- 1. business_domains gains is_primary / is_active / label / updated_at so a
--    business can own MANY domains and the super admin can manage them.
-- 2. normalize_host() + resolve_business_id_by_host() turn a request Host /
--    Origin into a business_id. EXECUTE is granted to service_role ONLY, so
--    the mapping (and therefore the business_id) never leaks to a browser.
-- ===========================================================================

ALTER TABLE public.business_domains
  ADD COLUMN IF NOT EXISTS is_primary boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active  boolean      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS label      text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz  NOT NULL DEFAULT now();

UPDATE public.business_domains
   SET domain = lower(btrim(domain))
 WHERE domain <> lower(btrim(domain));

CREATE INDEX IF NOT EXISTS business_domains_business_id_idx
  ON public.business_domains (business_id);

WITH ranked AS (
  SELECT domain,
         business_id,
         row_number() OVER (PARTITION BY business_id ORDER BY created_at, domain) AS rn
    FROM public.business_domains
)
UPDATE public.business_domains d
   SET is_primary = true
  FROM ranked r
 WHERE r.domain = d.domain
   AND r.rn = 1
   AND NOT EXISTS (
     SELECT 1 FROM public.business_domains x
      WHERE x.business_id = d.business_id AND x.is_primary
   );

CREATE UNIQUE INDEX IF NOT EXISTS business_domains_one_primary_per_business
  ON public.business_domains (business_id)
  WHERE is_primary;

-- Host normalization: strip scheme, port and path, lowercase, trim.
CREATE OR REPLACE FUNCTION public.normalize_host(p_host text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(p_host, ''))), '^[a-z][a-z0-9+.-]*://', ''),
      '[:/?#].*$', ''
    ),
    ''
  )
$function$;

-- Host -> business_id: exact hostname, then www-stripped, then left-most label.
CREATE OR REPLACE FUNCTION public.resolve_business_id_by_host(p_host text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH h AS (SELECT public.normalize_host(p_host) AS host),
  candidates AS (
    SELECT host AS d, 1 AS pri FROM h WHERE host IS NOT NULL
    UNION ALL
    SELECT regexp_replace(host, '^www\.', ''), 2 FROM h WHERE host LIKE 'www.%'
    UNION ALL
    SELECT split_part(host, '.', 1), 3 FROM h WHERE host IS NOT NULL
  )
  SELECT bd.business_id
    FROM candidates c
    JOIN public.business_domains bd
      ON bd.domain = c.d AND bd.is_active
   ORDER BY c.pri, bd.is_primary DESC
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.resolve_business_id_by_host(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_business_id_by_host(text) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_business_id_by_host(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_business_id_by_host(text) TO service_role;

-- Public tenant identity for a host — deliberately WITHOUT business_id.
CREATE OR REPLACE FUNCTION public.tenant_public_identity(p_host text)
 RETURNS TABLE (slug text, business_name text, name_abbreviation text, logo_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT bd.domain,
         b.business_name,
         b.name_abbreviation,
         b.logo_url
    FROM public.business_domains bd
    JOIN public.businesses b ON b.business_id = bd.business_id
   WHERE bd.business_id = public.resolve_business_id_by_host(p_host)
     AND bd.is_primary
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.tenant_public_identity(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tenant_public_identity(text) FROM anon;
REVOKE ALL ON FUNCTION public.tenant_public_identity(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_public_identity(text) TO service_role;
