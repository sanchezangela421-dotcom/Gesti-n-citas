# Synkros — Plataforma de Gestión de Citas

Aplicación web full-stack para gestionar citas entre alumnos y especialistas de bienestar estudiantil (Psicología, Tutorías, Nutrición). Diseñada para instituciones educativas que quieran digitalizar y centralizar su atención personalizada.

---

## Características principales

- **Tres roles** — Alumno, Especialista y Administrador con paneles dedicados
- **Agenda inteligente** — Horarios recurrentes, por semana o por fecha específica
- **Citas presenciales y virtuales** — Con soporte para enlaces de videollamada
- **Notificaciones en tiempo real** — In-app y por correo electrónico en cada cambio de estado
- **Publicación de contenido** — Eventos, talleres y material educativo por departamento
- **Reportes y estadísticas** — Exportación a PDF con métricas demográficas y de atención
- **Dark mode** — Interfaz adaptable al tema del sistema

---

## Estructura del proyecto

```
Synkros/
├── project_final/   # Frontend → React + Vite + TypeScript
└── server/          # Backend  → Node.js + Express + Prisma + SQLite
```

---

## Puesta en marcha

Requisitos: **Node.js 18+** y **pnpm 9+**.

```bash
# Instalar pnpm si no lo tienes
npm install -g pnpm
```

Abre **dos terminales** simultáneas — una para el backend y otra para el frontend.

---

### Terminal 1 — Backend

```bash
cd server

pnpm install

# Crear archivo de variables de entorno (solo la primera vez)
cp .env.example .env   # o crea el archivo manualmente (ver sección Variables de Entorno)

# Generar el cliente de Prisma
pnpm prisma generate

# Crear las tablas en la base de datos
pnpm prisma migrate deploy

# Poblar con datos iniciales (solo la primera vez)
pnpm ts-node src/seed.ts

# Iniciar en modo desarrollo (puerto 3000)
pnpm dev
```

> El servidor queda disponible en **http://localhost:3000**

---

### Terminal 2 — Frontend

```bash
cd project_final

pnpm install

pnpm dev
```

> La aplicación queda disponible en **http://localhost:5173**

---

## Arquitectura

### Frontend (`project_final/`)

| Capa | Tecnología |
|------|-----------|
| Framework | React 18 + TypeScript |
| Bundler | Vite |
| Estilos | TailwindCSS |
| Componentes | shadcn/ui (Radix UI) |
| Estado global | React Context + custom stores |
| Gráficas | Recharts |
| Exportación | jsPDF + html2canvas |

### Backend (`server/`)

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js |
| Framework | Express.js |
| ORM | Prisma |
| Base de datos | SQLite (desarrollo) / PostgreSQL (producción) |
| Auth | JSON Web Tokens (JWT) |
| Archivos | Multer |
| Correo | Nodemailer |

---

## API REST

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Iniciar sesión |
| POST | `/api/auth/register` | Registrar usuario |
| GET | `/api/specialists` | Listar especialistas |
| GET | `/api/specialists/:id/available-slots?date=` | Horarios disponibles |
| POST | `/api/specialists/:id/schedules` | Agregar horario |
| DELETE | `/api/specialists/:id/schedules/:slotId` | Eliminar horario |
| GET | `/api/appointments` | Listar citas |
| POST | `/api/appointments` | Crear cita |
| PATCH | `/api/appointments/:id/status` | Cambiar estado de cita |
| PATCH | `/api/appointments/:id/reschedule` | Reagendar cita |
| GET | `/api/events` | Listar eventos |
| POST | `/api/events` | Crear evento |
| GET | `/api/resources` | Listar recursos |
| POST | `/api/resources` | Crear recurso |
| GET | `/api/notifications` | Notificaciones del usuario |
| GET | `/api/stats` | Estadísticas globales |
| GET | `/api/periods` | Períodos de reporte |

---

## Modelos de base de datos

```
User          → Alumno, Especialista o Admin
Specialist    → Perfil del especialista, vinculado a User
ScheduleSlot  → Bloques de disponibilidad por especialista
Appointment   → Cita entre alumno y especialista
AppEvent      → Evento o taller publicado
Resource      → Material de apoyo (infografías, videos, enlaces)
Notification  → Alertas internas del sistema
ReportPeriod  → Períodos para corte y reporte de atención
```

---

## Scripts

### Backend
| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor de desarrollo con hot-reload |
| `npm run build` | Compila TypeScript a JavaScript |
| `npm start` | Servidor de producción |
| `npx prisma studio` | Interfaz visual de la base de datos |
| `npx ts-node src/seed.ts` | Poblar BD con datos iniciales |

### Frontend
| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm run preview` | Previsualizar el build |

---

## Variables de entorno

Crea `server/.env` con el siguiente contenido:

```env
DATABASE_URL=file:./prisma/dev.db
JWT_SECRET=cambia-esto-por-una-clave-segura
PORT=3000

# Opcional: dominio permitido para correos institucionales
ALLOWED_EMAIL_DOMAIN=tuinstitucion.edu.mx

# Opcional: URL del frontend (para CORS)
FRONTEND_URL=http://localhost:5173

# Opcional: configuración SMTP para envío de correos
SMTP_HOST=smtp.tuproveedor.com
SMTP_PORT=587
SMTP_USER=no-reply@tudominio.com
SMTP_PASS=tu-contrasena
```

> Para producción, asegúrate de que `.env` esté en `.gitignore` y usa una `JWT_SECRET` aleatoria y larga.

---

## Despliegue en producción

1. **Base de datos** — Migrar de SQLite a PostgreSQL: actualizar `DATABASE_URL` y el provider en `schema.prisma`
2. **Backend** — Compilar con `npm run build` y levantar con PM2: `pm2 start dist/index.js --name synkros-api`
3. **Frontend** — Compilar con `npm run build` y servir la carpeta `dist/` con Nginx
4. **Proxy inverso** — Configurar Nginx para enrutar `/api/*` al backend y el resto al frontend estático
5. **Archivos subidos** — Montar la carpeta `uploads/` en almacenamiento persistente (volumen o S3)
