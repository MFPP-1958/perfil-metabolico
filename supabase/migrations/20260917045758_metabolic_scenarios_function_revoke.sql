-- Explicit revoke also covers installations with legacy default API grants.
-- supabase db diff cannot produce this migration either. Verified, not assumed:
-- `supabase db diff -f metabolic_scenarios_function_revoke`, run after
-- supabase/schemas/01_core.sql already declared this revoke, reported
-- "No schema changes found" (diff: ""), and generated no file. The shadow
-- database it builds does not carry the same legacy default-ACL entry
-- (type 'f', functions) that the real, already-initialized local database
-- has, so it never sees anon/authenticated holding EXECUTE on
-- prevent_metabolic_scenario_mutation() in the first place, and therefore
-- never has anything to revoke. Live pg_proc.proacl for that function
-- currently reads
-- {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- (PUBLIC, anon and authenticated all still hold EXECUTE). This statement is
-- not new intent: it restates, explicitly, the revoke that
-- supabase/schemas/01_core.sql already declares next to the function, so the
-- real database matches the declared schema.

revoke all on function public.prevent_metabolic_scenario_mutation() from public, anon, authenticated;
