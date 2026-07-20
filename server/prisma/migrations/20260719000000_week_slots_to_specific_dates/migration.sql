-- Los slots con "week" (0 = semana actual, 1 = próxima) se comparaban contra la
-- semana relativa a la fecha de consulta: los week=0 reaparecían TODAS las semanas
-- para siempre y los week=1 desaparecían justo al llegar su semana.
-- Se anclan a fecha específica tomando como referencia la semana vigente al
-- ejecutar esta migración (date_trunc('week') = lunes ISO; dayOfWeek 1=Lun…5=Vie).
UPDATE "ScheduleSlot"
SET "specificDate" = to_char(
      date_trunc('week', CURRENT_DATE)::date + (("week" * 7) + ("dayOfWeek" - 1)),
      'YYYY-MM-DD'
    ),
    "week" = NULL
WHERE "week" IN (0, 1)
  AND "specificDate" IS NULL;

-- Cualquier otro valor de week se normaliza: pasa a recurrente semanal (NULL).
-- A partir de ahora la aplicación siempre guarda week = NULL.
UPDATE "ScheduleSlot"
SET "week" = NULL
WHERE "week" IS NOT NULL;
