-- Retención del expediente clínico (NOM-004) + baja lógica de usuarios.
--
-- Antes de esta migración, dar de baja a una persona borraba historial:
--   · borrar un Specialist arrastraba TODAS sus citas (Appointment.specialistId CASCADE)
--   · borrar un User arrastraba sus citas Y su expediente (ClinicalNote.studentId CASCADE)
--   · borrar una cita arrastraba su nota clínica (ClinicalNote.appointmentId CASCADE)
--
-- A partir de aquí las bajas son LÓGICAS (deletedAt) y la base de datos rechaza
-- cualquier borrado físico que se lleve por delante una nota clínica, incluso si
-- se ejecuta a mano por fuera de la aplicación.

-- ── 1. Baja lógica de usuarios ───────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- ── 2. Las citas dejan de morir con sus protagonistas ────────────────────────
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_studentId_fkey";
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_specialistId_fkey";
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_specialistId_fkey"
  FOREIGN KEY ("specialistId") REFERENCES "Specialist"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 3. El expediente es intocable ────────────────────────────────────────────
ALTER TABLE "ClinicalNote" DROP CONSTRAINT "ClinicalNote_studentId_fkey";
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClinicalNote" DROP CONSTRAINT "ClinicalNote_appointmentId_fkey";
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ClinicalNote_specialistId_fkey ya era RESTRICT desde 20260614010000.

-- ── 4. Coherencia de bajas previas ───────────────────────────────────────────
-- Especialistas ya marcados como dados de baja: su cuenta de usuario debe quedar
-- también dada de baja para que no pueda iniciar sesión.
UPDATE "User" u
SET "deletedAt" = s."deletedAt"
FROM "Specialist" s
WHERE s."userId" = u."id"
  AND s."deletedAt" IS NOT NULL
  AND u."deletedAt" IS NULL;
