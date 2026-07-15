-- ============================================================================
-- Super Admin (platform admin) support
-- Adds a cross-tenant admin concept, independent of any business, that can
-- provision new businesses + their owner accounts from a dedicated subdomain.
--
-- A platform admin is an auth.users row listed in public.platform_admins.
-- Provisioning itself is performed by the service role (which bypasses RLS);
-- these policies only let an admin confirm their own membership from the app.
-- ============================================================================

-- ---- Table ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  email text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.platform_admins
  ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);

ALTER TABLE public.platform_admins
  ADD CONSTRAINT platform_admins_user_id_key UNIQUE (user_id);

ALTER TABLE public.platform_admins
  ADD CONSTRAINT platform_admins_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ---- Helper ---------------------------------------------------------------
-- True when the current auth user is an active platform admin. SECURITY DEFINER
-- so it can read platform_admins regardless of the caller's RLS context.
CREATE OR REPLACE FUNCTION public.current_user_is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = auth.uid() AND is_active
  )
$function$;

-- ---- RLS ------------------------------------------------------------------
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- An admin may read their own membership row (used by the login flow to
-- verify a signed-in user is actually a platform admin). All writes go
-- through the service role, which bypasses RLS.
DROP POLICY IF EXISTS platform_admins_select_own ON public.platform_admins;
CREATE POLICY platform_admins_select_own ON public.platform_admins
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================================
-- Seed the first super admin (MANUAL — run AFTER the auth user exists).
--
-- Step 1: create the auth user (you set the password):
--   Supabase Dashboard → Authentication → Users → Add user
--     email:    maxmos.abdelsayed@gmail.com
--     password: <your chosen password>   (tick "Auto Confirm User")
--
-- Step 2: run the query below. It resolves the user's UUID by email, so no
-- copy/paste of the id is needed. Kept commented so applying the migration
-- before the auth user exists does not silently insert nothing.
--
-- INSERT INTO public.platform_admins (user_id, email)
-- SELECT id, email
-- FROM auth.users
-- WHERE email = 'maxmos.abdelsayed@gmail.com'
-- ON CONFLICT (user_id) DO NOTHING;
-- ============================================================================
