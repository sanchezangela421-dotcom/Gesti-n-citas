-- Cómo entra cada organización a sus usuarios finales.
--
-- Hasta ahora lo decidía ALLOWED_EMAIL_DOMAIN, una sola variable del proceso
-- aplicada igual a toda la plataforma. Con una organización funcionaba; con
-- varias es imposible de configurar: si se pone el dominio de la escuela, el
-- hospital no puede registrar a nadie, y si se deja vacía, cualquiera entra a
-- la organización que elija del selector público.
--
-- El modelo que la reemplaza parte de un hecho del negocio: dentro de una misma
-- organización el personal tiene correo institucional, pero los usuarios finales
-- no siempre. El paciente de un hospital llega con el correo que tenga.
--
--   open        cualquier correo               (hospital que acepta pacientes)
--   domain      debe estar en la lista         (escuela)
--   invitation  nadie se autorregistra         (clínica cerrada, empresa)

-- El valor por defecto es 'open' A PROPÓSITO, y solo para esta migración: es lo
-- que hacían TODAS las organizaciones hasta ahora, así que las filas que ya
-- existen conservan exactamente su comportamiento y nada se rompe al aplicarla.
-- Las organizaciones NUEVAS no usan este valor: su modo lo deduce del giro la
-- ruta de creación (lib/registration.ts → defaultRegistrationMode).
--
-- Conviene revisar las organizaciones existentes en el panel después de migrar:
-- quedan abiertas porque así estaban, no porque alguien lo haya decidido.
ALTER TABLE "Organization"
  ADD COLUMN "userRegistrationMode" TEXT NOT NULL DEFAULT 'open';

-- Dominios aceptados en modo `domain`. Sirven además como comprobación opcional
-- al dar de alta personal: si la organización los declaró, el alta de un
-- especialista con otro dominio se rechaza.
ALTER TABLE "Organization"
  ADD COLUMN "allowedEmailDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
