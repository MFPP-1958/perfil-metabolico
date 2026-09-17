-- Explicit revokes also cover installations with legacy default API grants.
-- supabase db diff cannot produce this migration: its shadow database never carries
-- the legacy default-ACL entry that grants anon/authenticated/service_role full table
-- privileges on newly created relations in schema public, so the leak this closes does
-- not exist there to be diffed. supabase/schemas/02_rls.sql already declares the
-- correct revoke/grant for public.metabolic_scenarios; this migration states it
-- explicitly so the real, already-initialized local database matches it.

revoke all on table public.metabolic_scenarios from public, anon, authenticated, service_role;

grant select on table public.metabolic_scenarios to authenticated;

grant select, insert on table public.metabolic_scenarios to service_role;
