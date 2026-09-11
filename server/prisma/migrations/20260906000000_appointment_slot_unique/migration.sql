-- Un especialista no puede tener dos citas VIVAS en el mismo horario.
--
-- Hasta ahora esto se garantizaba solo en la aplicación: `POST /appointments` y
-- `PATCH /:id/reschedule` hacían `findFirst` y, si no había choque, `create`.
-- Ambas cosas dentro de una `$transaction`, lo que parecía suficiente pero no lo
-- es: PostgreSQL corre en READ COMMITTED, donde una transacción NO ve las filas
-- que otra todavía no confirmó. Dos peticiones simultáneas para el mismo hueco
-- pasaban las dos la comprobación y creaban las dos la cita. El especialista se
-- enteraba cuando llegaban dos personas a la misma hora.
--
-- La comprobación en la aplicación se conserva porque da el mensaje de error
-- bueno en el 99% de los casos; esto es la red debajo, para el 1% de carrera.
--
-- Es un índice PARCIAL: las citas canceladas quedan fuera a propósito, para que
-- cancelar libere el horario y otra persona pueda tomarlo. Sin el WHERE, una
-- cancelación bloquearía ese hueco para siempre.
--
-- Nota para quien mantenga el schema: Prisma no sabe expresar índices parciales
-- en `schema.prisma`, así que este objeto vive SOLO aquí. No lo borres pensando
-- que sobra por no encontrarlo en el modelo `Appointment`.
CREATE UNIQUE INDEX "Appointment_active_slot_key"
  ON "Appointment" ("specialistId", "date", "time")
  WHERE "status" <> 'Cancelada';
