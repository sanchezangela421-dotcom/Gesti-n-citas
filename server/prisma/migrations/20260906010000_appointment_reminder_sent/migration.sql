-- Marca de que ya se envió el recordatorio de esta cita.
--
-- Es lo que hace idempotente al planificador: la fila se "reclama" con un
-- UPDATE condicionado a que siga en NULL, así que aunque corran varias
-- instancias del servidor (o el intervalo se solape consigo mismo), solo una
-- gana la carrera y el recordatorio sale UNA vez. Sin esta columna, cada
-- ejecución reenviaría el mismo correo.
--
-- Nullable a propósito: NULL = todavía no se ha enviado. Las citas que ya
-- existen nacen en NULL, pero el planificador solo mira las de mañana, así que
-- no se dispara una avalancha de recordatorios retroactivos al desplegar.
ALTER TABLE "Appointment" ADD COLUMN "reminderSentAt" TIMESTAMP(3);

-- El planificador busca por fecha + estado y descarta lo ya enviado. Sin este
-- índice, cada pasada recorrería la tabla entera de citas.
CREATE INDEX "Appointment_reminder_pending_idx"
  ON "Appointment" ("date", "status")
  WHERE "reminderSentAt" IS NULL;
