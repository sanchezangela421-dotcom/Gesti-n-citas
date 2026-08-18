# Plan de pruebas — departamentos por organización, notas obligatorias y correcciones de QA

Guía para el equipo de QA. Cubre **únicamente** los cambios posteriores a la
ronda de inasistencias (commit `749fb82a`). Lo validado en rondas anteriores
—retención del expediente, bajas lógicas, estados de especialista y
organización, horarios solapados, inasistencias y plantillas de correo— **no se
repite aquí**.

> **Importante:** la base de datos **no se regenera**. Los cambios se aplican con
> migraciones, que añaden tablas y columnas **conservando los datos**. Recrear la
> base destruiría expedientes clínicos, cuya conservación es obligación legal.

---

## 1. Puesta en marcha

### Requisitos

- Node ≥ 18 · pnpm ≥ 9 · PostgreSQL corriendo (local o Docker)
- Una bandeja de correo de prueba ([Mailtrap](https://mailtrap.io) recomendado):
  varias pruebas verifican correos.

### Backend

> ### ⚠️ Al clonar o al hacer `git pull`, corre SIEMPRE los pasos (1) y (2)
>
> Si te saltas `prisma migrate deploy`, la aplicación arranca pero **falla al
> primer uso** con errores del tipo `The table "public.OrgDepartment" does not
> exist`. No es un bug: es que tu base va atrasada respecto al código.
> Para ver si te falta algo: `pnpm exec prisma migrate status`.

```bash
cd server

pnpm install
pnpm exec prisma generate         # (1) OBLIGATORIO — ver nota
pnpm exec prisma migrate deploy   # (2) OBLIGATORIO — aplica las migraciones nuevas
pnpm db:seed                      # (3) SOLO si la base está vacía
pnpm db:backfill-fields           # (4) SOLO si ya tenías organizaciones creadas
pnpm dev                          # arranca en http://localhost:3000
```

**(1) `prisma generate` no es opcional.** El cliente de Prisma se construye a
partir del esquema y no está en el repositorio. `pnpm install` no lo genera de
forma fiable, y sin él el proyecto **no compila**. Si aparece
`Module '@prisma/client' has no exported member 'PrismaClient'`, es que faltó
este paso.

**(2)** Aplica solo lo pendiente y conserva los datos existentes.

Migración que introduce esta tanda:

| Migración | Qué hace |
|---|---|
| `20260818164913_org_departments` | Tabla `OrgDepartment`: cada organización define sus departamentos. Convierte los que ya tenía en filas, conservando el nombre exacto |

**No borra nada.** Siembra el catálogo a partir de lo que cada organización tenía
contratado. Si un departamento estaba retirado pero seguía con citas o
especialistas, se crea igualmente pero **inactivo**, para no perder su
configuración de nota clínica.

**(3)** El seed es **destructivo si ya hay datos** (hace `upsert` sobre la
organización TECNL). Sobre una base con datos reales, sáltalo.

**(4)** Solo hace falta si creaste organizaciones **antes** de esta tanda:
nacían sin campos de registro, así que su formulario no pedía fecha de
nacimiento ni género y sus gráficas demográficas salían vacías. Es aditivo e
idempotente — solo toca organizaciones con cero campos y nunca pisa una
configurada a mano. Para ver qué haría sin escribir:
`pnpm db:backfill-fields -- --dry-run`.

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
> propia sesión.

### Pruebas automatizadas

```bash
cd server
pnpm test          # 201 pruebas
```

Crea y migra sola una base aparte con sufijo `_test`. No toca la de desarrollo.

---

## 2. Plan de pruebas

Prioridad: **🔴 crítica** (pérdida de datos o acceso indebido) · **🟠 alta** ·
**🟡 media**.

---

### Bloque A — Departamentos por organización 🔴

> **El cambio más grande de esta tanda.** Los tres departamentos dejaron de ser
> un catálogo fijo de plataforma: **cada organización define los suyos**, con su
> color, su icono y si exigen nota clínica. Se gestionan desde el botón
> **Departamentos** de la tarjeta de la organización en `/superadmin` — ya no son
> casillas en el formulario de edición.

#### A1 · Nada se perdió con la migración 🔴

**Precondición:** una base que ya tenía organizaciones antes de esta tanda.

1. Entrar en `/superadmin` → **Departamentos** de una organización existente.

**Resultado esperado:** aparecen los mismos que tenía contratados, con sus
colores de siempre (Psicología azul, Tutorías verde, Nutrición naranja) y con
*"Nota obligatoria"* marcado en **Psicología y Nutrición**, no en Tutorías.
⚠️ Si alguno cambió de nombre o desapareció, es un fallo grave: el expediente
clínico los referencia por nombre.

#### A2 · Crear un departamento propio 🟠

1. *Agregar departamento* → nombre "Trabajo Social", elegir color e icono,
   **sin** marcar *"Exige nota"*.
2. Como admin de esa organización, crear un especialista ahí.
3. Como usuario, agendar una cita en ese departamento.

**Resultado esperado:**
- Al crear, avisa de que el nombre no podrá cambiarse una vez tenga citas.
- Aparece en el panel del admin **con el color y el icono elegidos**, no genéricos.
- El asistente de nueva cita lo ofrece y, como no tiene motivos preestablecidos,
  pide el motivo en un **campo de texto libre**.
- El especialista **puede cerrar la cita sin escribir nota**.

#### A3 · Departamento propio que SÍ exige nota 🔴

1. Crear "Psiquiatría" **marcando** *"Exige nota al cerrar la cita"*.
2. Agendar y confirmar una cita ahí. Como especialista, intentar completarla
   con las anotaciones **vacías**.

**Resultado esperado:** no se permite. El campo aparece como obligatorio y el
servidor lo rechaza. Con la nota escrita, se completa.

#### A4 · El nombre se sella al primer uso 🔴

1. Sobre el departamento de A2 (que ya tiene citas), intentar **renombrarlo**.

**Resultado esperado:** se rechaza explicando que ya tiene citas o especialistas.
⚠️ Intencional: el expediente lo referencia **por nombre**, y renombrarlo
desconectaría al paciente de su historial.

2. Cambiarle solo el **color** o el **icono**.

**Resultado esperado:** eso **sí** se permite. Lo sellado es el nombre.

3. Intentar **eliminarlo**.

**Resultado esperado:** se rechaza y sugiere retirarlo. Uno recién creado por
error, sin citas, **sí** se puede eliminar.

#### A5 · Retirar un departamento 🟠

**Precondición:** un especialista de *Nutrición* y un usuario con cita
**Confirmada** en Nutrición.

1. En el gestor, pulsar el icono de apagado en *Nutrición*.

**Resultado esperado:**
- **La cita Confirmada NO se cancela.** ⚠️ Si se cancela, es un fallo.
- El usuario y el especialista reciben **correo** avisando; el usuario ve que
  **su cita se mantiene**.
- Nutrición desaparece del selector del alumno y el admin no puede crear
  especialistas ahí.
- El especialista de Nutrición entra con normalidad y **puede cerrar sus citas**.
- Volver a activarlo lo restaura sin efectos secundarios.

#### A6 · Aislamiento entre organizaciones 🔴

1. Crear "Trabajo Social" en la organización A.
2. Abrir el gestor de la organización B.

**Resultado esperado:** B **no** lo ve. Dos organizaciones pueden tener un
departamento con el mismo nombre sin interferir.

---

### Bloque B — Notas al cerrar la cita 🔴

#### B1 · Cerrar exige nota en departamentos clínicos 🔴

**Precondición:** una cita **Confirmada** de **Psicología** o **Nutrición**.

1. Como el especialista asignado, pulsar *Completar* y dejar el campo vacío.

**Resultado esperado:** no se permite. El campo se llama **Nota clínica** y lleva
asterisco de obligatorio. Con la nota escrita, la cita se completa y queda en el
expediente.

#### B2 · Tutorías no la exige 🟠

1. Repetir sobre una cita de **Tutorías**.

**Resultado esperado:** el campo se llama **Observaciones**, es **opcional** y la
cita se cierra sin escribir nada. ⚠️ Intencional: Tutorías es acompañamiento
académico, no atención clínica, y la NOM-004 no le aplica. Si el tutor sí
escribe algo, se guarda igual.

#### B3 · El admin ya no puede completar citas 🔴

1. Como **admin**, intentar marcar una cita como *Completada*.

**Resultado esperado:** no se permite. El admin gestiona la agenda —confirmar,
cancelar, reagendar— pero **no cierra la atención**. Registrar una
**inasistencia** sí sigue pudiendo: es un hecho administrativo, no clínico.

---

### Bloque C — Reactivar bajas desde el panel 🟠

> Dar de baja ya funcionaba; lo que faltaba era **poder deshacerlo desde la
> interfaz**. El backend ya lo soportaba pero ninguna pantalla lo ofrecía.

#### C1 · Reactivar un especialista 🟠

**Precondición:** un especialista dado de baja.

1. Como admin → pestaña *Especialistas* → botón **"Ver dados de baja"**.

**Resultado esperado:**
- Aparece una sección con los dados de baja y su **fecha de baja**.
- Al pulsar *Reactivar*, vuelve al directorio activo y puede iniciar sesión.
- Sus citas canceladas **no** se reabren.

#### C2 · Reactivar un usuario 🟠

**Precondición:** un alumno/paciente dado de baja.

1. Como admin → pestaña de usuarios → **"Ver dados de baja"** → *Reactivar*.

**Resultado esperado:** recupera el acceso. Los **especialistas no aparecen** en
esa lista: se reactivan desde su propia pestaña, que además restaura su perfil.

---

### Bloque D — Reportes y estadísticas 🟠

> El cálculo de las gráficas se movió del navegador al servidor. La consecuencia
> a vigilar: **la pantalla y el PDF deben dar exactamente los mismos números**.

#### D1 · Pantalla y PDF coinciden 🟠

1. Como admin → *Estadísticas*, anotar el total y el reparto por departamento.
2. Descargar el PDF del mismo período.

**Resultado esperado:** los números **cuadran**. Antes cada uno los calculaba por
su cuenta y podían discrepar.

#### D2 · "No asistió" aparece en el reporte 🟠

1. Con al menos una inasistencia registrada, descargar el PDF.

**Resultado esperado:** en *Resumen de Actividad* hay una fila **"No asistió"**, y
el **Total de Citas cuadra con la suma** de los estados. Antes las inasistencias
desaparecían de la contabilidad.

#### D3 · Distribución de Edad en una organización nueva 🔴

1. En `/superadmin`, **crear una organización nueva**.
2. Registrar usuarios rellenando la **fecha de nacimiento** y agendarles citas.
3. Como admin de esa organización → *Estadísticas*.

**Resultado esperado:**
- El formulario de registro **sí pide** fecha de nacimiento y género: una
  organización nueva ya nace con esos campos.
- **"Distribución de Edad" muestra datos.** ⚠️ Antes salía siempre vacía: la
  clave se guardaba normalizada y el servidor la buscaba en otro formato.

#### D4 · Campos propios en el PDF 🟠

**Precondición:** una organización con un campo de registro tipo **select**
(ej. "Área" con opciones Urgencias / Consulta externa), con usuarios que lo
rellenaron y citas agendadas.

1. Descargar el reporte PDF.

**Resultado esperado:** incluye una sección **"Distribución por Campos de la
Organización"** con ese campo. Antes el PDF solo sabía de carrera, género,
semestre y edad, así que una organización no escolar exportaba tablas de
"No especificado".

---

### Bloque E — Etiquetas del usuario final 🟡

> Cada organización nombra a sus usuarios (Alumno / Paciente / Empleado). Varios
> textos seguían diciendo "alumno" a secas.

#### E1 · Los avisos usan la etiqueta correcta 🟡

**Precondición:** una organización cuyo nombre de usuario **no** sea "Alumno"
(ej. un hospital con "Paciente").

1. Como especialista de esa organización, abrir los modales de **confirmar cita
   virtual**, **confirmar presencial**, **finalizar cita** y **reagendar**.
2. Como admin, revisar el **encabezado de la tabla de citas** y el **buscador**.

**Resultado esperado:** todos dicen "paciente" / "Paciente", nunca "alumno".

---

### Bloque F — Sedes 🟡

#### F1 · La pestaña se ve correctamente 🟡

1. Como admin → pestaña *Sedes*.

**Resultado esperado:** el contenido respeta el margen de la tarjeta como el
resto de las pestañas (antes iba pegado al borde), con el listado a la izquierda
y el alta a la derecha. En móvil las filas se apilan.

#### F2 · Editar, desactivar y eliminar 🟠

1. Crear una sede, luego **editarle el nombre**.
2. **Desactivarla** con el botón correspondiente.
3. Intentar **eliminarla**.

**Resultado esperado:**
- Editar y desactivar funcionan; una sede inactiva se marca como **"Inactiva"** y
  **desaparece del selector del especialista**, pero se puede reactivar.
- Eliminar **pide confirmación** explicando que los especialistas que la tengan
  asignada quedarán sin sede, y que **las citas ya confirmadas no se ven
  afectadas** porque guardan la ubicación como texto.

---

### Bloque G — Panel de SuperAdmin 🟡

#### G1 · Modo claro 🟡

1. Entrar en `/superadmin` y pulsar el **icono de sol/luna** de la barra superior.

**Resultado esperado:** el panel cambia a modo claro por completo — fondos,
tarjetas, tablas, modales, insignias y textos de color. ⚠️ Revisar sobre todo
los **mensajes de error** y las **insignias de rol y plan**: son los que antes
estaban afinados solo para oscuro y podían quedar ilegibles. La preferencia se
recuerda al recargar y se comparte con el resto de la aplicación.

#### G2 · El aviso de baja dice la verdad 🔴

1. En la pestaña de usuarios, pulsar el botón de baja de un usuario.

**Resultado esperado:** el modal dice que la cuenta **pierde el acceso** y que
**los datos NO se eliminan** por retención del expediente. ⚠️ Antes afirmaba
*"Esta acción es irreversible, se eliminarán todos los datos"*, lo cual era
falso.

#### G3 · Iconos coherentes 🟡

1. Comparar el botón de eliminar un **campo de registro** con el de dar de baja
   un **usuario** y el de suspender una **organización**.

**Resultado esperado:** solo el de campos de registro es una **papelera** (es el
único que borra de verdad). Los otros dos son iconos de **apagado**, porque
suspenden sin borrar.

---

### Bloque H — Eventos 🟠

#### H1 · Inscritos visibles por departamento 🟠

**Precondición:** una conferencia publicada por un especialista, con al menos un
inscrito, y **otro especialista del mismo departamento**.

1. Entrar como el segundo especialista → pestaña de eventos → pulsar el contador
   de inscritos.

**Resultado esperado:** **ve la lista**. Antes solo la veía quien publicó el
evento, aunque la conferencia sea del departamento.

2. Entrar como un especialista de **otro departamento**.

**Resultado esperado:** no puede verla.

---

### Bloque I — Regresión 🟠

Recorrido completo, para confirmar que nada de lo anterior rompió el flujo:

1. Registrar un usuario nuevo → verificar correo → iniciar sesión.
2. Agendar una cita (departamento → especialista → fecha → hora → motivo).
3. Como especialista, confirmarla (virtual con enlace y presencial con sede).
4. Reagendarla desde cada lado.
5. Completarla con su nota.
6. Consultar el expediente del paciente.
7. Como admin, revisar que aparece en el listado y en las estadísticas.
8. Hacer un corte de período y descargar el PDF.

---

## 3. Fuera de alcance

Cosas que **no** cambian y no hace falta probar como nuevas:

- Los **motivos de cita preestablecidos** solo existen para Psicología, Tutorías
  y Nutrición. Un departamento propio pide el motivo como texto libre; no hay
  pantalla para configurarle una lista.
- El **admin de la organización no gestiona departamentos**: solo el superadmin
  los crea, renombra y retira.
- La **tarjeta de descarga del PDF** de un departamento propio usa un degradado
  gris genérico (sí respeta su icono). Los tres originales conservan el suyo.
- El panel del login muestra siempre los tres originales: es previo al inicio de
  sesión y no hay organización de la que leer.
- Todo lo validado en rondas anteriores: retención del expediente, bajas
  lógicas, estados de especialista y organización, horarios solapados,
  inasistencias y plantillas de correo.

## 4. Cómo reportar

Al abrir una incidencia, incluir: **caso** (ej. A4), rol usado, pasos, resultado
esperado y obtenido. Para fallos del backend, adjuntar la consola donde corre
`pnpm dev`.

Marcar como **bloqueante** cualquier fallo marcado 🔴: son los que pueden
implicar pérdida de expedientes o acceso indebido.
