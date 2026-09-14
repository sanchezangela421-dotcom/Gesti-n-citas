# Plan de pruebas — endurecimiento previo al lanzamiento

Guía para el equipo de QA. Cubre los cambios desde `9c3a39b2` hasta `00f11d40`.
Todo lo validado en rondas anteriores —departamentos por organización, notas
obligatorias, retención del expediente, bajas lógicas, reportes, sedes,
eventos— **no se repite aquí**.

| Bloque | Cambio | Problema que resolvía |
|---|---|---|
| **A** | Reserva única de horario | Dos personas podían quedarse con la **misma cita** si pulsaban a la vez |
| **B** | Recordatorios de 24 h | Las plantillas de correo existían pero **nadie las enviaba** |
| **C** | Calendario en una petición | El asistente disparaba **~60 peticiones** y podía dejar al usuario bloqueado |
| **D** | Avisos que no mienten | Salían **"guardado" y el error a la vez**, y editar podía borrar lo que ya había |
| **E** | Cola de correo | Dos envíos simultáneos se pisaban y el proveedor rechazaba uno |
| **F** | Auditoría de accesos | Una fuerza bruta contra una cuenta **no dejaba ningún rastro** |
| **G** | Bitácora consultable | No se podía responder *"¿qué pasó desde esta IP?"* desde la pantalla |
| **H** | Tema del superadmin | La pestaña activa era casi invisible; el login no dejaba cambiar de tema |

> **Importante:** la base de datos **no se regenera**. Los cambios se aplican con
> migraciones, que añaden columnas e índices **conservando los datos**. Recrear
> la base destruiría expedientes clínicos, cuya conservación es obligación legal.

---

## 1. Puesta en marcha

### Requisitos

- Node ≥ 18 · pnpm ≥ 9 · PostgreSQL corriendo (local o Docker)
- Una bandeja de correo de prueba ([Mailtrap](https://mailtrap.io) recomendado).
  **Los bloques B y E dependen de ella por completo.**

### Backend

> ### ⚠️ Al clonar o al hacer `git pull`, corre SIEMPRE los pasos (1) y (2)
>
> Si te saltas `prisma migrate deploy`, la aplicación arranca pero **falla al
> primer uso**, con errores del tipo `The column "AuditLog.userAgent" does not
> exist`. No es un bug: es que tu base va atrasada respecto al código.
> Para ver si te falta algo: `pnpm exec prisma migrate status`.

```bash
cd server

pnpm install
pnpm exec prisma generate         # (1) OBLIGATORIO — ver nota
pnpm exec prisma migrate deploy   # (2) OBLIGATORIO — aplica las migraciones nuevas
pnpm db:seed                      # (3) SOLO si la base está vacía
pnpm dev                          # arranca en http://localhost:3000
```

**(1) `prisma generate` no es opcional.** El cliente de Prisma se construye a
partir del esquema y no está en el repositorio. `pnpm install` no lo genera de
forma fiable, y sin él el proyecto **no compila**. Si aparece
`Module '@prisma/client' has no exported member 'PrismaClient'`, es que faltó
este paso.

**(2)** Aplica solo lo pendiente y conserva los datos existentes.

Migraciones que introduce esta tanda:

| Migración | Qué hace |
|---|---|
| `20260906000000_appointment_slot_unique` | Índice **único parcial** sobre `(specialistId, date, time)`. Impide dos citas vivas del mismo especialista a la misma hora. Es **parcial**: excluye las canceladas, para que cancelar libere el horario |
| `20260906010000_appointment_reminder_sent` | Columna `Appointment.reminderSentAt` + su índice. Es el candado que evita que un recordatorio se envíe dos veces |
| `20260910000000_audit_auth_events` | Columna `AuditLog.userAgent` + tres índices (por acción, por fecha, por IP). Son los que hacen consultable la bitácora del bloque G |

**No borran nada** y son puramente aditivas: dos columnas nullable e índices.

> ⚠️ **Si la primera migración falla** con
> `could not create unique index "Appointment_active_slot_key"`, **no la fuerces
> ni borres nada**: significa que tu base ya tiene citas duplicadas en el mismo
> horario, creadas por el bug que este cambio corrige. Repórtalo indicando el
> mensaje completo — hay que decidir con qué cita se queda cada choque.
>
> Para ver los choques antes de migrar:
> ```sql
> SELECT "specialistId", "date", "time", COUNT(*)
> FROM "Appointment" WHERE "status" <> 'Cancelada'
> GROUP BY 1,2,3 HAVING COUNT(*) > 1;
> ```

**(3)** El seed es **destructivo si ya hay datos** (hace `upsert` sobre la
organización TECNL). Sobre una base con datos reales, sáltalo.

### Variables de entorno nuevas

Todas son opcionales y traen valores por defecto sanos. Están en
`server/.env.example`:

| Variable | Por defecto | Para qué |
|---|---|---|
| `REMINDERS_ENABLED` | `true` | `false` apaga los recordatorios sin tocar código |
| `REMINDERS_INTERVAL_MINUTES` | `60` | Cada cuánto revisa si hay recordatorios pendientes |
| `EMAIL_MIN_INTERVAL_MS` | `1100` | Separación mínima entre correos. Encaja con planes que permiten 1 por segundo |
| `EMAIL_MAX_RETRIES` | `3` | Reintentos cuando el proveedor pide bajar el ritmo |

> **Para el bloque B, pon `REMINDERS_INTERVAL_MINUTES=1`.** Con el valor por
> defecto tendrías que esperar una hora entre comprobaciones.

Al arrancar el backend debe aparecer en consola:

```
[reminders] Planificador activo — revisión cada 1 min
```

Si no aparece esa línea, los recordatorios **no están corriendo** y el bloque B
no se puede probar.

### Frontend

```bash
cd project_final
pnpm install
pnpm dev                    # arranca en http://localhost:5173
```

**No necesita `.env`.** El servidor de desarrollo reenvía `/api` y `/uploads` al
backend, igual que hace nginx en producción. Por eso el navegador solo habla con
el puerto **5173** y no hace falta configurar ninguna dirección.

> **Para probar desde un celular u otra computadora**, expón **solo el puerto
> 5173** (reenvío de puertos de VS Code o similar) y ponlo en visibilidad
> **Pública**. El 3000 no hace falta. Si el reenvío falla con
> `[forwarding] exited with code 1`, el problema es de red o antivirus en esa
> máquina, no del proyecto: pruébalo con la laptop en el hotspot del celular.

### Cuentas del seed

Todas con contraseña **`Admin1234`**:

| Rol | Correo | Dónde entra |
|---|---|---|
| Admin | `admin@mail.com` | `/` |
| Especialista | `especialista@mail.com` | `/` |
| Alumno | `alumno@mail.com` | `/` |
| SuperAdmin | `superadmin@gestioncitas.app` | **`/superadmin`** |

### Pruebas automatizadas

```bash
cd server
pnpm test          # 266 pruebas en 24 archivos
```

Crea y migra sola una base aparte con sufijo `_test`. **No toca la de
desarrollo, y ya no manda correo de verdad** — antes llenaba la bandeja de
Mailtrap con direcciones `@test.local` y gastaba la misma cuota que necesita
quien está probando la aplicación.

De esas, **65 son nuevas de esta tanda**:

```bash
pnpm exec vitest run tests/appointment-slot-race.test.ts   # 5   (bloque A)
pnpm exec vitest run tests/appointment-reminders.test.ts   # 10  (bloque B)
pnpm exec vitest run tests/available-days.test.ts          # 13  (bloque C)
pnpm exec vitest run tests/email-queue.test.ts             # 7   (bloque E)
pnpm exec vitest run tests/audit-auth.test.ts              # 16  (bloque F)
pnpm exec vitest run tests/superadmin-audit.test.ts        # 14  (bloque G)
```

> **El frontend no tiene pruebas automatizadas.** Todo lo visual —los bloques D
> y H por completo, y la parte de pantalla de los demás— solo se valida
> mirándolo. Es donde tu trabajo es insustituible.

---

## 2. Plan de pruebas

Prioridad: **🔴 crítica** (pérdida de datos o acceso indebido) · **🟠 alta** ·
**🟡 media**.

---

### Bloque A — Una cita, una persona 🔴

> Antes, dos personas que pulsaban "agendar" en el mismo horario con
> milisegundos de diferencia se llevaban **ambas** la cita. El especialista se
> enteraba cuando llegaban dos personas a la misma hora.

#### A0 · Sobre cómo probar esto 📌 **Léelo antes de empezar**

La condición de carrera **no se reproduce a mano de forma fiable**: hay que
disparar las peticiones con milisegundos de diferencia, y dos personas pulsando
en dos navegadores casi nunca lo consiguen. **Que no logres reproducirlo
pulsando botones no demuestra nada.**

Por eso hay una prueba automatizada que sí lo fuerza, y es la verificación
principal:

```bash
cd server
pnpm exec vitest run tests/appointment-slot-race.test.ts
```

**Resultado esperado:** 5 pruebas en verde.

Los casos A1–A4 **sí** son comprobables a mano y es lo que se te pide verificar
en la interfaz.

#### A1 · El segundo en llegar recibe un aviso claro 🟠

**Precondición:** un especialista con horario publicado y dos cuentas de usuario.

1. Con el usuario 1, agendar una cita en un horario concreto.
2. Con el usuario 2, intentar agendar **ese mismo horario**.

**Resultado esperado:** el horario **ya no aparece** en la lista de horas libres.
Si se fuerza (recargando el asistente antes de que refresque), sale un mensaje
tipo *"Este horario ya fue reservado. Por favor elige otro."* — nunca un error
genérico ni una pantalla en blanco.

#### A2 · Cancelar libera el horario 🔴

1. Sobre la cita creada en A1, que el usuario 1 la **cancele**.
2. Con el usuario 2, intentar agendar ese mismo horario.

**Resultado esperado:** **ahora sí se puede.** ⚠️ Es el caso más importante del
bloque: el índice se hizo *parcial* justo para esto. Si el horario quedara
bloqueado para siempre tras una cancelación, es un fallo grave.

#### A3 · Reagendar a un horario ocupado se rechaza 🟠

**Precondición:** dos citas del **mismo especialista** en horarios distintos.

1. Reagendar la primera cita al horario que ocupa la segunda.

**Resultado esperado:** se rechaza con el mismo aviso de horario ocupado. La cita
original **se queda donde estaba**, sin cambios.

#### A4 · El historial de cancelaciones no estorba 🟠

1. Agendar y **cancelar** una cita en un horario.
2. Volver a agendar ese mismo horario y **cancelarla** también.
3. Agendar una tercera vez.

**Resultado esperado:** las tres operaciones funcionan. Pueden convivir varias
citas canceladas en el mismo hueco — son historial y deben conservarse. Solo se
impide que haya **dos vivas a la vez**.

#### A5 · (Opcional) Forzar la carrera desde la terminal 🟡

Solo si quieres verlo con tus propios ojos. En **Git Bash** (el `&` final es lo
que las lanza de verdad en paralelo):

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alumno@mail.com","password":"Admin1234"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# Sustituye SPEC_ID y la fecha por un horario libre real
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/appointments \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{"specialistId":"SPEC_ID","date":"2026-10-15","time":"10:00","modality":"Virtual","motivo":"Prueba"}' &
done; wait
```

**Resultado esperado:** exactamente **un `201`** y **cuatro `409`**. Si sale más
de un `201`, es un fallo bloqueante.

---

### Bloque B — Recordatorios de 24 h 🟠

> Funcionalidad **nueva**: nunca se había enviado un recordatorio. Las plantillas
> llevaban meses escritas sin que nadie las llamara.

**Precondición para todo el bloque:** `REMINDERS_INTERVAL_MINUTES=1` en el `.env`
del servidor, Mailtrap configurado, y la línea `[reminders] Planificador activo`
visible en la consola al arrancar.

#### B1 · Llega el recordatorio a las dos partes 🟠

1. Agendar una cita para **mañana** y que el especialista la **confirme**.
2. Esperar a la siguiente revisión (con el intervalo en 1, hasta un minuto).

**Resultado esperado:** en Mailtrap llegan **dos correos**:
- Al usuario: *"Recordatorio: tienes una cita mañana"*.
- Al especialista: *"Recordatorio: cita con [nombre] mañana"*.

Ambos con **fecha y hora legibles** (*"martes, 10 de septiembre de 2026"*,
*"10:00 AM"*), nunca en crudo (`2026-09-10`, `10:00`). Si la cita es virtual,
el correo del usuario incluye el enlace.

En la consola aparece una línea como:
`[reminders] 1 enviados, 0 omitidos, 0 fallidos (de 1 candidatas)`

> Los dos correos llegan **separados por un segundo largo**. Es deliberado (ver
> bloque E), no un fallo.

#### B2 · No se envía dos veces 🔴

1. Tras B1, **esperar varias revisiones más** (2–3 minutos).

**Resultado esperado:** **no llegan más correos** de esa cita. ⚠️ Es el caso
crítico del bloque: sin esto el usuario recibiría un recordatorio cada hora hasta
la cita. La consola deja de mencionar candidatas.

2. **Reiniciar el backend** y esperar otra revisión.

**Resultado esperado:** sigue sin reenviarse. La marca vive en la base de datos,
no en memoria.

#### B3 · Una cita solo Pendiente no se recuerda 🟠

1. Agendar una cita para mañana y **NO confirmarla** (dejarla en *Pendiente*).
2. Esperar varias revisiones.

**Resultado esperado:** **no llega recordatorio.** ⚠️ Es intencional: una cita
pendiente todavía no es un acuerdo entre las dos partes, y avisar *"tienes una
cita mañana"* de algo que el especialista aún no aceptó genera más confusión que
asistencia.

#### B4 · Una cita cancelada no se recuerda 🟠

1. Confirmar una cita de mañana y **cancelarla** antes de la siguiente revisión.

**Resultado esperado:** no llega recordatorio.

#### B5 · Solo se recuerda lo de mañana 🟠

1. Tener citas confirmadas para **hoy**, **mañana** y **pasado mañana**.

**Resultado esperado:** solo llega el recordatorio de la de **mañana**. Las otras
dos se quedan sin correo (la de pasado mañana lo recibirá al día siguiente).

#### B6 · Organización suspendida y personas dadas de baja 🟠

1. Con una cita confirmada para mañana, **suspender la organización** desde
   `/superadmin` antes de la revisión.

**Resultado esperado:** **no se envía correo.** No se manda correo en nombre de
una organización suspendida.

2. Repetir con una cita cuyo **usuario haya sido dado de baja**.

**Resultado esperado:** tampoco se envía. En consola cuenta como *omitidos*.

#### B7 · El interruptor apaga de verdad 🟡

1. Poner `REMINDERS_ENABLED=false` y reiniciar el backend.

**Resultado esperado:** en consola aparece
`[reminders] Desactivados por REMINDERS_ENABLED=false` y **no se envía ningún
recordatorio**, aunque haya citas confirmadas para mañana.

---

### Bloque C — Calendario en una sola petición 🟠

> El asistente de nueva cita preguntaba al servidor **día por día** qué días
> tenían hueco: unas 60 peticiones por especialista y mes. Con el límite de 500
> peticiones cada 15 minutos, un usuario comparando varios especialistas
> **agotaba su propia cuota** y la aplicación se le rompía sin explicación.
>
> **El comportamiento visible no debe cambiar en nada.** Lo que cambia es cuánto
> cuesta.

#### C1 · La mejora se ve en la red 🟠

1. Abrir las **herramientas de desarrollo** del navegador (F12) → pestaña
   **Red / Network**, y filtrar por `available`.
2. Como usuario, abrir el asistente de nueva cita y llegar al paso del
   **calendario**, eligiendo un especialista.

**Resultado esperado:** **una sola petición** a `available-days`. ⚠️ Si ves
decenas de peticiones a `available-slots` seguidas, el cambio no está aplicado
(¿frontend sin reconstruir?).

3. Pulsar un día concreto.

**Resultado esperado:** *ahí sí* aparece **una** petición a `available-slots`,
la del día elegido. Eso es correcto.

4. Cambiar de mes adelante y atrás varias veces.

**Resultado esperado:** una petición por cambio, no una ráfaga.

#### C2 · Los días marcados son los correctos 🔴

**Precondición:** un especialista con horarios publicados en **varios días** del
mes.

1. Como usuario, abrir el calendario de ese especialista.

**Resultado esperado:** aparecen seleccionables **exactamente** los días con
horario publicado. Los días sin horario están deshabilitados, y **los días
pasados nunca son seleccionables**, ni siquiera al retroceder de mes.

#### C3 · Coherencia entre el día y sus horas 🔴

1. Pulsar **uno por uno** todos los días marcados como disponibles.

**Resultado esperado:** **todos** ofrecen al menos un horario. ⚠️ Es la garantía
que sostiene el calendario: si un día aparece disponible y al abrirlo está
vacío, es un fallo — significa que el cálculo del calendario y el de las horas se
han separado.

#### C4 · Un día que se llena desaparece 🟠

**Precondición:** un día en que el especialista tenga **un solo horario** libre.

1. Reservar ese horario con otro usuario.
2. Recargar el asistente y mirar el calendario.

**Resultado esperado:** ese día **ya no es seleccionable**.

3. **Cancelar** esa cita y recargar.

**Resultado esperado:** el día **vuelve a estar disponible**.

#### C5 · Especialista inactivo 🟠

1. Como admin, **desactivar** un especialista.
2. Como usuario, intentar llegar a su calendario.

**Resultado esperado:** no aparece como opción. Si se fuerza, el calendario sale
**vacío** — sin error ni pantalla rota.

#### C6 · Hoy no ofrece horas ya pasadas 🟠

**Precondición:** un especialista con horarios publicados **para hoy**, algunos
ya pasados y otros por venir.

1. Abrir el calendario y seleccionar **hoy**.

**Resultado esperado:** solo aparecen los horarios **futuros**. Si ya pasaron
todos los de hoy, el día no debería ofrecerse.

---

### Bloque D — Avisos que no mienten 🔴 **(NUEVO)**

> Reportado en la ronda anterior: al publicar un horario de 5pm a 1pm salían
> **los dos avisos a la vez** — *"Horario agregado"* y *"Rango inválido"*. La
> causa era que la pantalla cantaba el éxito sin esperar la respuesta del
> servidor. Al perseguirlo apareció algo peor: **editar podía borrar el horario
> que ya tenías**.
>
> Todo este bloque es de pantalla: **no hay pruebas automatizadas que lo
> cubran.**

#### D1 · Un rango inválido da UN solo aviso 🟠

1. Como especialista → *Mis Horarios* → añadir un horario de **17:00 a 13:00**.

**Resultado esperado:**
- Sale **solo el error**, nunca un "Horario agregado" junto a él.
- El formulario **sigue abierto**, con lo que escribiste, para corregir.
- **No se crea ningún horario.**

#### D2 · Editar con un rango inválido NO borra el que ya existe 🔴

**Precondición:** un horario ya publicado, por ejemplo 09:00–13:00.

1. Pulsar el lápiz para **editarlo** y poner **17:00 a 13:00**. Guardar.

**Resultado esperado:** sale el error y **el horario de 09:00–13:00 sigue ahí**.
⚠️ El caso más grave del bloque: antes se borraba el anterior antes de crear el
nuevo, así que un rango mal escrito te dejaba **sin ninguno de los dos** — y
encima con un mensaje diciendo que todo salió bien.

2. Recargar la página para confirmar que sigue en la base, no solo en pantalla.

#### D3 · Eliminar un horario 🟠

1. Eliminar un horario existente.

**Resultado esperado:** desaparece y sale **un** aviso de eliminado. Si algo
falla, el horario **vuelve a la lista** en vez de desaparecer de la pantalla
aunque siga existiendo.

#### D4 · Un modal que falla no se lleva lo escrito 🔴

Hace falta **dos navegadores** (o dos sesiones).

1. Navegador 1, como **alumno**: tener una cita Pendiente.
2. Navegador 2, como **especialista**: abrir el modal de confirmar esa cita y
   escribir el enlace de videollamada — **sin confirmar todavía**.
3. Volver al navegador 1 y **cancelar la cita**.
4. Volver al navegador 2 y pulsar confirmar.

**Resultado esperado:** sale **solo el error** explicando que no se pudo, el
**modal sigue abierto** y **el enlace que escribiste sigue ahí**. Nunca un
"Cita confirmada" seguido de un error.

#### D5 · Lo mismo al cerrar una cita 🔴

1. Repetir D4, pero en el modal de **finalizar la cita** y escribiendo una
   **nota clínica larga** antes de que el alumno cancele.

**Resultado esperado:** la **nota escrita no se pierde**. Antes el modal se
cerraba pasara lo que pasara y había que volver a escribirla entera.

#### D6 · Lo normal sigue funcionando 🟠

1. Publicar un horario válido, confirmar una cita, reagendar y cancelar, todo
   por el camino normal.

**Resultado esperado:** un solo aviso de éxito en cada caso, y el modal se cierra.

---

### Bloque E — Cola de correo 🟠 **(NUEVO)**

> Durante la ronda anterior un recordatorio falló con
> `550 Too many emails per second`. No era del proveedor: cada parte del sistema
> espaciaba sus propios correos, pero **nadie coordinaba entre ellas**, así que
> dos flujos a la vez se pisaban. Ahora todo el correo sale por una sola cola.

#### E1 · Varios correos a la vez no se pierden 🟠

1. En un par de minutos, provocar varios correos seguidos: agendar dos citas,
   confirmar una y cancelar otra.

**Resultado esperado:** **todos** los correos llegan a Mailtrap, separados entre
sí por algo más de un segundo. **No** aparece `Too many emails per second` en la
consola del servidor.

#### E2 · Un recordatorio y una cita al mismo tiempo 🟠

1. Con `REMINDERS_INTERVAL_MINUTES=1`, agendar una cita justo cuando toca la
   revisión de recordatorios.

**Resultado esperado:** llegan los correos de las dos cosas. Era exactamente el
choque que fallaba antes.

#### E3 · Si el proveedor pide calma, se reintenta 🟡

Solo si llegas a verlo: cuando el proveedor limita el ritmo, en consola aparece

```
[email] el proveedor pidió bajar el ritmo; reintento 1/3
```

y el correo **acaba llegando**. Si en su lugar ves un error sin reintentos,
repórtalo.

---

### Bloque F — Auditoría de accesos 🟠 **(NUEVO)**

> Antes, **solo** el acceso del superadmin dejaba rastro. Una fuerza bruta contra
> la cuenta de un especialista no aparecía en ninguna parte.

Todo se revisa en `/superadmin` → pestaña **Auditoría**.

#### F1 · Un inicio de sesión normal queda registrado 🟠

1. Entrar como alumno en `/`.
2. En `/superadmin` → Auditoría, buscar la entrada más reciente.

**Resultado esperado:** aparece **"Inicio de sesión"** con la **IP** y el
**navegador** resumido (por ejemplo *"Windows · Chrome"*).

#### F2 · Una contraseña incorrecta queda registrada con su motivo 🟠

1. Intentar entrar con un correo real y **contraseña equivocada**.

**Resultado esperado:** aparece **"Intento de acceso fallido"** en rojo, con el
detalle **"contraseña incorrecta"**.

#### F3 · La pantalla no revela si el correo existe, la bitácora sí 🔴

1. Intentar entrar con un **correo que no existe**.
2. Intentar entrar con un correo **real** y contraseña equivocada.

**Resultado esperado:**
- Al usuario, las **dos** pantallas dicen exactamente lo mismo ("Credenciales
  inválidas"). ⚠️ Si una dijera "el correo no existe", cualquiera podría
  averiguar qué cuentas hay.
- En la bitácora, en cambio, se distinguen: una dice **"el correo no está
  registrado"** y la otra **"contraseña incorrecta"**. Es lo que separa a alguien
  probando correos al azar de alguien insistiendo sobre una cuenta concreta.

#### F4 · El resto de eventos de cuenta 🟠

1. Registrar un usuario nuevo, verificar su correo y pedir un restablecimiento
   de contraseña.

**Resultado esperado:** los tres aparecen como **"Registro de cuenta"**,
**"Correo verificado"** y **"Solicitó restablecer contraseña"**.

---

### Bloque G — Bitácora consultable 🟠 **(NUEVO)**

> El panel solo filtraba por organización y paginaba. Con volumen real,
> responder *"todos los intentos fallidos desde esta IP"* era imposible.

#### G1 · Filtrar por acción 🟠

1. En Auditoría, elegir **"Intento de acceso fallido"** en el selector y filtrar.

**Resultado esperado:** solo salen esas. El selector muestra **cuántas hay de
cada tipo** entre paréntesis.

#### G2 · Filtrar por IP y por correo 🟠

1. Copiar una IP de cualquier entrada, pegarla en el campo **IP** y filtrar.
2. Limpiar, y ahora escribir en **Correo tanteado** el correo de un intento
   fallido de F2.

**Resultado esperado:** en ambos casos solo salen las entradas que coinciden.

#### G3 · Filtrar por fechas 🟠

1. Poner **Desde** y **Hasta** con la fecha de **hoy**.

**Resultado esperado:** salen las de hoy, **incluidas las de hace un momento**.
⚠️ Si las de la tarde no aparecen, avisa: sería el problema de zona horaria que
este cambio corrige.

#### G4 · Una fecha mal escrita se explica 🟡

1. Poner un rango **invertido** (Desde posterior a Hasta).

**Resultado esperado:** un mensaje claro explicando el problema, **no** una lista
vacía sin explicación.

#### G5 · El límite deja de ser invisible 🟡

1. Mirar el pie de la lista.

**Resultado esperado:** siempre se lee **"Mostrando 1–N de N"**. Al pasar de
**100** entradas aparecen además **Anterior / Siguiente**, y al cambiar de página
**el filtro se mantiene**.

#### G6 · Las consultas del superadmin dejan rastro 🔴

1. Entrar a la pestaña **Usuarios** y luego a **Organizaciones**.
2. Volver a **Auditoría**.

**Resultado esperado:** aparecen **"Consultó el listado de usuarios"** y
**"Consultó las organizaciones"**, con el filtro usado y cuántas filas vio.
⚠️ Es la única forensia si esa cuenta se compromete: el superadmin puede leerlo
todo, así que quien se apodere de su sesión no necesita cambiar nada para hacer
daño.

#### G7 · La bitácora no se audita a sí misma 🟡

1. Entrar y salir de la pestaña **Auditoría** varias veces, y filtrar.

**Resultado esperado:** eso **no** genera entradas nuevas. Sería ruido que crece
solo y entierra justo lo que vienes a buscar.

---

### Bloque H — Tema del superadmin 🟡 **(NUEVO)**

#### H1 · Se ve qué pestaña está activa 🟠

1. En `/superadmin`, cambiar entre Overview, Organizaciones, Usuarios y
   Auditoría, **en modo claro**.
2. Repetir en **modo oscuro** con el icono de sol/luna.

**Resultado esperado:** en los dos modos se distingue claramente cuál está
activa. ⚠️ Antes la pestaña activa y su contenedor usaban el mismo color
—blanco sobre blanco en claro— y solo se notaba por una sombra mínima.

#### H2 · El login también deja cambiar de tema 🟡

1. Cerrar sesión para llegar a `/superadmin` sin entrar.

**Resultado esperado:** hay un icono de sol/luna **arriba a la derecha**, y la
preferencia **se recuerda** al recargar y al entrar al panel.

#### H3 · Insignias legibles en ambos modos 🟡

1. Mirar las insignias de **plan** (free / basic / enterprise) y de **rol** en
   claro y en oscuro.

**Resultado esperado:** se leen bien en los dos. Nada de texto claro sobre fondo
claro.

---

### Bloque I — Regresión 🟠

Recorrido completo, para confirmar que nada de lo anterior rompió el flujo:

1. Iniciar sesión como usuario y **agendar una cita** (departamento →
   especialista → fecha → hora → motivo).
2. Como especialista, **confirmarla** (virtual con enlace y presencial con sede).
3. **Reagendarla** desde cada lado.
4. **Completarla** con su nota (obligatoria en Psicología y Nutrición).
5. Consultar el **expediente** del paciente.
6. Como admin, revisar que aparece en el **listado** y en las **estadísticas**.
7. Descargar el **PDF** del período.

**Resultado esperado:** todo funciona igual que antes. Los cambios de esta tanda
son de robustez, rendimiento y trazabilidad; **ninguno debía alterar el flujo
visible**, salvo los avisos, los correos de recordatorio y el panel de auditoría.

---

## 3. Fuera de alcance

Cosas que **no** cambian y no hace falta probar como nuevas:

- **La carrera de doble reserva no se reproduce a mano.** Ver A0: la verificación
  real es la prueba automatizada. No inviertas horas pulsando botones en dos
  navegadores.
- **Los recordatorios no son configurables por organización ni por usuario.** No
  hay pantalla para activarlos o desactivarlos: es global, por variable de
  entorno. Tampoco hay recordatorio a otras horas (48 h, 1 h antes).
- **El recordatorio no aparece como notificación dentro de la aplicación**, solo
  como correo.
- **Un recordatorio que falla del todo no se reintenta más tarde.** La cola sí
  reintenta cuando el proveedor pide bajar el ritmo (bloque E), pero si aun así
  no sale, esa cita ya no recibirá otro: se consideró peor molestar dos veces que
  perder uno. El fallo queda en el log del servidor.
- **La bitácora no se purga nunca todavía.** Falta definir cuánto tiempo hay que
  conservar cada tipo de registro; es una decisión legal pendiente, no un
  descuido. La tabla solo crece.
- **El superadmin no puede leer notas clínicas**, y eso no cambió: el contenido
  del expediente está fuera de su alcance por diseño.
- Todo lo validado en rondas anteriores: departamentos por organización, notas
  obligatorias al cerrar, retención del expediente, bajas lógicas, reportes y
  estadísticas, sedes, eventos y plantillas de correo.

## 4. Cómo reportar

Al abrir una incidencia, incluir: **caso** (ej. D2), rol usado, pasos, resultado
esperado y obtenido. Para fallos del backend, adjuntar la consola donde corre
`pnpm dev` — los recordatorios y la cola de correo escriben ahí su resultado.

**Para los bloques D, G y H, adjunta captura.** Son de pantalla y no hay ninguna
prueba automatizada que los cubra: lo que no se vea ahí, no se detecta.

Marcar como **bloqueante** cualquier fallo marcado 🔴: son los que pueden
implicar dos personas en la misma cita, un horario o una nota clínica perdidos,
un acceso sin rastro o un recordatorio enviado en bucle.
