-- Fase B4 (contract): migra los datos de "Appointment.notes" a sus destinos finales
-- y elimina la columna deprecada. El backfill corre ANTES del DROP.

-- 1) Notas clínicas de citas completadas → ClinicalNote (solo si aún no existe una)
INSERT INTO "ClinicalNote" ("id", "appointmentId", "specialistId", "studentId", "department", "organizationId", "body", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a."id", a."specialistId", a."studentId", a."department", a."organizationId", a."notes", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Appointment" a
WHERE a."status" = 'Completada'
  AND a."notes" IS NOT NULL
  AND a."notes" <> ''
  AND NOT EXISTS (SELECT 1 FROM "ClinicalNote" c WHERE c."appointmentId" = a."id");

-- 2) Motivo de cancelación → cancellationReason (solo si está vacío)
UPDATE "Appointment"
SET "cancellationReason" = "notes"
WHERE "status" = 'Cancelada'
  AND "notes" IS NOT NULL
  AND "cancellationReason" IS NULL;

-- 3) Eliminar la columna deprecada
ALTER TABLE "Appointment" DROP COLUMN "notes";
