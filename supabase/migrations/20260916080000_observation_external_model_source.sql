-- Origen propio para los valores que produce un programa de terceros (WKO5, INSCYD).
-- Hasta ahora sólo cabían como 'manual' o 'calculated', que no dicen quién los calculó.
--
-- ESCRITA A MANO: no hay Docker en el equipo, así que no se pudo generar con
-- `supabase db diff`. Verificar con la CLI contra un proyecto desechable antes de
-- aplicarla en producción.

alter table public.observations
  add column if not exists source_reference jsonb;

alter table public.observations
  drop constraint if exists observations_origin_check;

alter table public.observations
  add constraint observations_origin_check
    check (origin in ('manual', 'intervals_icu', 'laboratory', 'field_test', 'device', 'calculated', 'external_model'));

alter table public.observations
  add constraint observations_source_reference_shape
    check (source_reference is null or source_reference ? 'software');

-- La correspondencia es exacta en los dos sentidos: un valor de origen externo nombra
-- siempre su programa, y ningún otro origen puede atribuirse uno.
alter table public.observations
  add constraint observations_external_model_source
    check ((origin = 'external_model') = (source_reference is not null));

comment on column public.observations.source_reference is
  'Programa de terceros que calculó el valor, p. ej. {"software":"WKO5","version":"5.0.16"}. Obligatorio si origin = external_model.';
