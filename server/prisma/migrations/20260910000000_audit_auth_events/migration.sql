-- Navegador del cliente en la bitácora.
--
-- Hasta ahora se guardaba la IP pero NO el agente de usuario, así que era
-- imposible distinguir "la misma persona desde su navegador de siempre" de
-- "un script recorriendo la API": las dos cosas se veían igual en el panel.
-- Es la mitad que faltaba para poder caracterizar un intento sospechoso.
--
-- Nullable: las entradas anteriores a esta migración no lo tienen, y hay
-- acciones internas que no nacen de una petición HTTP.
ALTER TABLE "AuditLog" ADD COLUMN "userAgent" TEXT;

-- Índices para poder CONSULTAR la bitácora, que era el otro problema: hasta
-- ahora solo existían ("organizationId","createdAt") y ("actorId"), de modo que
-- las tres preguntas que de verdad se le hacen a un registro de seguridad
-- obligaban a recorrer la tabla entera.

-- "¿Qué intentos fallidos de acceso hubo?" — filtra por acción, ordena por fecha.
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog" ("action", "createdAt" DESC);

-- "¿Qué pasó en la plataforma últimamente?" — el panel del superadmin lista en
-- orden cronológico SIN filtrar por organización, y para ese caso el índice
-- compuesto por organizationId no sirve.
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog" ("createdAt" DESC);

-- "¿Qué ha hecho esta IP?" — la pregunta con la que se caracteriza un ataque.
CREATE INDEX "AuditLog_ipAddress_createdAt_idx" ON "AuditLog" ("ipAddress", "createdAt" DESC);
