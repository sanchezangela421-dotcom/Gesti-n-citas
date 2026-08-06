# Plan de pruebas — retención del expediente, bajas, departamentos y estadísticas

Guía para el equipo de QA. Cubre los cambios de la rama `laloFixes`.

> **Importante:** la base de datos **no se regenera**. Los cambios se aplican con
> migraciones, que añaden columnas y restricciones **conservando los datos**.
> Recrear la base destruiría expedientes clínicos, cuya conservación es
> obligación legal y ahora está protegida a nivel de base de datos.

---

## 1. Puesta en marcha

### Requisitos

- Node ≥ 18 · pnpm ≥ 9 · PostgreSQL corriendo (local o Docker)
- Una bandeja de correo de prueba ([Mailtrap](https://mailtrap.io) recomendado):
  varias pruebas verifican correos.

### Backend

```bash
cd server

cp .env.example .env        # y rellenar DATABASE_URL, JWT_SECRET y SMTP_*

pnpm install
pnpm exec prisma generate         # (1) OBLIGATORIO — ver nota
pnpm exec prisma migrate deploy   # (2) aplica las migraciones nuevas
pnpm db:seed                      # (3) SOLO si la base está vacía
pnpm dev                          # arranca en http://localhost:3000
```

**(1) `prisma generate` no es opcional.** El cliente de Prisma se construye a
partir del esquema y no está en el repositorio. `pnpm install` no lo genera de
forma fiable, y sin él el proyecto **no compila**. Si aparece
`Module '@prisma/client' has no exported member 'PrismaClient'`, es que faltó
este paso.

**(2)** Aplica solo lo pendiente y conserva los datos existentes. Para ver qué
falta antes de aplicarlo: `pnpm exec prisma migrate status`.

Migraciones que introduce esta rama:

| Migración | Qué hace |
|---|---|
| `20260804000000_clinical_retention_soft_delete` | `User.deletedAt` y las claves foráneas del expediente pasan a `RESTRICT` |
| `20260805000000_org_contracted_departments` | `Organization.departments` (las organizaciones existentes conservan los tres) |

**(3)** El seed es **destructivo si ya hay datos** (hace `upsert` sobre la
organización TECNL). Sobre una base con datos reales, sáltalo.

### Frontend

```bash
cd project_final
pnpm install
pnpm dev                    # arranca en http://localhost:5173
```

No necesita `.env` en local: por defecto apunta a `http://localhost:3000`.

### Cuentas del seed

Todas con contraseña **`Admin1234`**:

| Rol | Correo | Dónde entra |
|---|---|---|
| Admin | `admin@mail.com` | `/` |
| Especialista | `especialista@mail.com` | `/` |
| Alumno | `alumno@mail.com` | `/` |
| SuperAdmin | `superadmin@gestioncitas.app` | **`/superadmin`** |

> El superadmin **no** entra por el login normal: tiene su propia ruta y su
> propia sesión. Si intenta entrar por `/` recibe "Credenciales inválidas", y
> es intencional.

### Pruebas automatizadas

```bash
cd server
pnpm test          # 121 pruebas
```

Crea y migra sola una base aparte con sufijo `_test`. No toca la de desarrollo.

---

## 2. Plan de pruebas

Prioridad: **🔴 crítica** (pérdida de datos o acceso indebido) · **🟠 alta** ·
**🟡 media**.

---

### Bloque A — Retención del expediente clínico 🔴

> Regla que no puede romperse: **un expediente clínico nunca se borra.** Dar de
> baja a una persona corta su acceso, pero conserva su historial.

#### A1 · Dar de baja a un especialista con citas abiertas 🔴

**Precondición:** un especialista con al menos una cita *Pendiente*, una
*Confirmada* y una *Completada con nota clínica*.

1. Entrar como **admin** → pestaña *Especialistas*.
2. Pulsar el icono de baja del especialista.
3. Escribir un motivo (ej. "Cambio de adscripción") y confirmar.

**Resultado esperado:**
- El modal advierte que el expediente **se conserva** y que la baja es reversible.
- Aviso: *"Se cancelaron N citas y se avisó a los pacientes"*.
- Las citas *Pendiente* y *Confirmada* pasan a **Cancelada** con el motivo escrito.
- La cita **Completada NO cambia**. ⚠️ Si cambia, es un fallo grave.
- El alumno afectado recibe **correo** de cancelación con el motivo.
- El especialista desaparece de la lista.

#### A2 · La sesión del especialista se corta al instante 🔴

**Precondición:** el especialista de A1 con sesión abierta en otro navegador.

1. Sin cerrar su sesión, dar de baja al especialista desde el panel de admin.
2. En el navegador del especialista, navegar o recargar.

**Resultado esperado:** vuelve al login con el mensaje *"Tu cuenta fue dada de
baja..."*. No debe poder seguir operando aunque su sesión fuera reciente.

#### A3 · El expediente sobrevive a la baja 🔴

**Precondición:** haber ejecutado A1.

1. Entrar como **otro especialista del mismo departamento** que haya atendido al
   mismo paciente.
2. Ir a *Expedientes* → abrir ese paciente.

**Resultado esperado:** las notas clínicas del especialista dado de baja
**siguen visibles**, marcadas como de otro especialista.

#### A4 · Reactivar a un especialista 🟠

1. Como admin, mostrar los dados de baja y pulsar *Reactivar*.

**Resultado esperado:** vuelve a la lista y puede iniciar sesión. Sus citas
canceladas **no** se reabren: si el paciente quiere volver, agenda de nuevo.

#### A5 · Dar de baja a un alumno con expediente 🔴

**Precondición:** un alumno con al menos una cita completada y nota clínica.

1. Como admin → pestaña de usuarios → icono de baja.

**Resultado esperado:**
- Desaparece del listado y no puede iniciar sesión.
- En *Expedientes* del especialista **sigue apareciendo**, con la etiqueta
  **"Paciente inactivo"** y un aviso de que su expediente se conserva por
  obligación legal.
- Sus notas clínicas se abren y se leen con normalidad.

#### A6 · No se puede dar de baja a un especialista desde la pestaña de usuarios 🟡

1. Como admin, buscar la cuenta de un especialista en el listado de usuarios.

**Resultado esperado:** o no aparece, o al intentarlo indica que debe hacerse
desde *Especialistas*.

---

### Bloque B — Estados que antes no se aplicaban 🟠

#### B1 · Especialista marcado como inactivo 🟠

1. Como admin, editar un especialista y **desmarcar "Activo"**.
2. Entrar como **alumno** e iniciar el agendado de una cita.

**Resultado esperado:** ese especialista **no aparece** en el selector. Antes sí
aparecía y podía reservarse: es el fallo que se corrigió.

#### B2 · El inactivo conserva su trabajo 🟠

**Precondición:** el especialista de B1, con citas ya agendadas.

1. Entrar como ese especialista.

**Resultado esperado:**
- Entra con normalidad y ve un aviso ámbar explicando que está inactivo y que no
  recibirá solicitudes nuevas.
- **Puede confirmar y cerrar** las citas que ya tenía. Inactivo no es baja.

#### B3 · Organización suspendida 🔴

1. Entrar en **`/superadmin`** → desactivar una organización.
2. Intentar iniciar sesión con un usuario de esa organización.
3. Con otro usuario de la misma organización **ya logueado**, recargar.

**Resultado esperado:** el login se rechaza indicando que el acceso está
suspendido, y la sesión ya abierta se corta en la siguiente petición. Los
usuarios de **otras** organizaciones no se ven afectados.

#### B4 · Enlaces peligrosos rechazados 🟠

1. Como admin, crear un **recurso** con URL `javascript:alert(1)`.
2. Repetir creando un **evento** de tipo taller con ese enlace de registro.

**Resultado esperado:** ambos se rechazan indicando que debe ser una URL
`http(s)` válida. Con `https://ejemplo.com` se guardan sin problema.

#### B5 · Horarios solapados 🟠

1. Como especialista → *Mis Horarios*.
2. Publicar 09:00–11:00 en un día.
3. Publicar 10:00–12:00 el **mismo** día.
4. Publicar 11:00–13:00 el mismo día.
5. Publicar un horario en una **fecha pasada**.

**Resultado esperado:** el paso 3 se rechaza por solaparse; el 4 **sí** se
permite (contiguo, no solapado); el 5 se rechaza por ser fecha pasada.

---

### Bloque C — Departamentos contratados 🟠

#### C1 · Retirar un departamento 🟠

**Precondición:** una organización con los tres departamentos, un especialista
de *Nutrición* y un alumno con cita **Confirmada** en Nutrición.

1. Entrar en **`/superadmin`** → editar la organización.
2. En *Departamentos contratados*, **desmarcar Nutrición** y guardar.

**Resultado esperado:**
- El formulario advierte de lo que implica antes de guardar.
- **La cita Confirmada NO se cancela.** ⚠️ Si se cancela, es un fallo: la regla
  es respetar lo agendado.
- El alumno recibe **correo** avisando de la retirada y de que **su cita se
  mantiene**.
- El especialista de Nutrición recibe **correo** avisando de que dejará de
  recibir solicitudes.
- Ambos reciben también la notificación dentro de la aplicación (campana).

#### C2 · El departamento retirado desaparece 🟠

**Precondición:** C1 ejecutado.

1. Como **alumno**, iniciar el agendado.
2. Como **admin**, intentar crear un especialista en Nutrición.

**Resultado esperado:** Nutrición no aparece en el selector del alumno, y el
admin no puede crear especialistas en ese departamento. El alumno **sigue
viendo su cita** y su historial de Nutrición.

#### C3 · El especialista del departamento retirado 🟠

1. Entrar como el especialista de Nutrición.

**Resultado esperado:** entra con normalidad, ve su agenda, **puede cerrar sus
citas** y consultar expedientes. Solo deja de recibir solicitudes nuevas.

#### C4 · Volver a contratarlo 🟡

1. Como superadmin, volver a marcar Nutrición.

**Resultado esperado:** reaparece en el selector del alumno y el admin puede
volver a crear especialistas. Sin efectos secundarios.

---

### Bloque D — Estadísticas 🟡

#### D1 · TECNL no cambia 🟡

1. Como admin de TECNL → pestaña de estadísticas.

**Resultado esperado:** las mismas gráficas de siempre: mes, motivos,
modalidad, carrera, género, semestre y edad.

#### D2 · La gráfica de carrera cuadra 🟠

1. Con un alumno que tenga **3 citas**, revisar *Distribución por Carrera*.

**Resultado esperado:** su carrera suma **3**, no 1. La suma de todas las
carreras debe coincidir con el total de citas del panel. Antes contaba alumnos
distintos y no cuadraba.

#### D3 · Organización no escolar con campos propios 🟠

**Precondición:** en `/superadmin`, crear una organización tipo hospital y, en
*Campos de registro*, añadir un campo tipo **select** (ej. "Área" con opciones
Urgencias / Consulta externa). Registrar usuarios que lo rellenen y agendarles
citas.

1. Entrar como admin de esa organización → estadísticas.

**Resultado esperado:** aparece **"Distribución por Área"** con el reparto de
citas. Antes esa organización no tenía ninguna estadística de sus propios datos.

#### D4 · Las gráficas vacías no se muestran 🟡

**Precondición:** una organización cuyos usuarios no tengan género registrado.

**Resultado esperado:** la gráfica de género **no aparece**, en lugar de
mostrar "No especificado" al 100%. La de edad muestra *"Sin datos de fecha de
nacimiento"*.

---

### Bloque E — Correos 🟠

Se actualizó **nodemailer de la versión 8 a la 9** (cambio de versión mayor).
Conviene revisar en Mailtrap que todos los correos siguen llegando con su
formato: **logo visible**, asunto correcto y enlaces que funcionan.

| # | Correo | Cómo dispararlo |
|---|---|---|
| E1 | Verificación de cuenta | Registrarse |
| E2 | Recuperar contraseña | "¿Olvidaste tu contraseña?" |
| E3 | Invitación de cuenta | Admin crea un especialista |
| E4 | Solicitud de cita | Alumno agenda |
| E5 | Cita confirmada | Especialista confirma |
| E6 | Cita cancelada | Especialista cancela con motivo |
| E7 | Cita reagendada | Alumno o especialista reagenda |
| E8 | Baja de especialista | Caso A1 |
| E9 | Departamento retirado | Caso C1 |

En **E6** y **E8**, escribir un motivo con caracteres especiales
(`<b>prueba</b> & "comillas"`) y comprobar que el correo lo muestra **como
texto literal**, sin interpretarlo como formato.

---

### Bloque F — Regresión 🟠

Recorrido completo, para confirmar que nada de lo anterior rompió el flujo:

1. Registrar un alumno nuevo → verificar correo → iniciar sesión.
2. Agendar una cita (departamento → especialista → fecha → hora → motivo).
3. Como especialista, confirmarla (virtual con enlace y presencial con sede).
4. Reagendarla desde cada lado.
5. Completarla añadiendo nota clínica.
6. Consultar el expediente del paciente.
7. Como admin, revisar que la cita aparece en el listado y en las estadísticas.
8. Hacer un corte de período y descargar el PDF.

---

## 3. Fuera de alcance

Cosas que **no** cambian y no hace falta probar como nuevas:

- Los tres departamentos siguen siendo fijos: ninguna organización puede crear
  los suyos. Solo se elige cuáles tiene contratados.
- Semestre y edad siguen siendo gráficas exclusivas de organizaciones escolares.
  Un hospital con un campo numérico propio no obtiene gráfica de él.
- El panel del login muestra siempre los tres departamentos: es previo al inicio
  de sesión y no hay organización de la que leer.

## 4. Cómo reportar

Al abrir una incidencia, incluir: **caso** (ej. A1), rol usado, pasos, resultado
esperado y obtenido. Para fallos del backend, adjuntar la consola donde corre
`pnpm dev`.

Marcar como **bloqueante** cualquier fallo del Bloque A: son los que pueden
implicar pérdida de expedientes.
