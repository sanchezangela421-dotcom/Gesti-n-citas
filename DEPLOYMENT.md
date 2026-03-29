# Guía de Despliegue — Sistema de Citas TECNL

> Infraestructura objetivo: VPS WebhostingMX (Ubuntu 22.04)
> Carga esperada: ~300 usuarios/año — SQLite es suficiente.

---

## Estrategia de despliegue

Se utiliza **Git directamente en el VPS** — no se sube el `dist/` manualmente.

El flujo es:
```
Tu PC → git push → GitHub → VPS hace git pull → rebuild
```

**¿Por qué no subir el `dist/` por FTP?**
- El `dist/` está en `.gitignore` porque se genera en el servidor, no se versiona
- Subir archivos manualmente por FTP cada actualización es propenso a errores
- Con `git pull` actualizar toma menos de un minuto y es reproducible

Los archivos `.env` **no** están en el repositorio — se crean manualmente en el VPS una sola vez y persisten entre actualizaciones.

---

## Índice

1. [Requisitos del VPS](#1-requisitos-del-vps)
2. [Variables de entorno](#2-variables-de-entorno)
3. [Primer despliegue](#3-primer-despliegue)
4. [Crear el administrador inicial](#4-crear-el-administrador-inicial)
5. [Actualizar a una nueva versión](#5-actualizar-a-una-nueva-versión)
6. [Configurar backups automáticos](#6-configurar-backups-automáticos)
7. [Configurar nginx + HTTPS](#7-configurar-nginx--https)
8. [Checklist final antes de ir a producción](#8-checklist-final-antes-de-ir-a-producción)

---

## 1. Requisitos del VPS

```bash
# Node.js 18 o superior
node -v

# npm
npm -v

# PM2 (gestor de procesos para Node)
npm install -g pm2

# SQLite CLI (para backups)
sudo apt install sqlite3 -y
```

---

## 2. Variables de entorno

### Backend — `server/.env`

Crea o edita el archivo `server/.env` en el VPS con los valores de producción:

```env
# Base de datos — ruta FUERA del proyecto para no perderla en actualizaciones
DATABASE_URL="file:/var/www/citas-tecnl/data/prod.db"

# JWT — ya generado, no cambiar salvo que se quieran invalidar todas las sesiones
JWT_SECRET="<el valor generado con node -e crypto>"

# Dominio institucional permitido para registro de alumnos
ALLOWED_EMAIL_DOMAIN="nuevoleon.tecnm.mx"

# URLs públicas del VPS
BACKEND_URL="https://api.tudominio.mx"
FRONTEND_URL="https://citas.tudominio.mx"

# Carpeta de uploads FUERA del proyecto
UPLOADS_PATH="/var/www/citas-tecnl/uploads"

# SMTP — proveedor real (ej. Brevo, SendGrid, SMTP institucional)
SMTP_HOST="smtp.tuproveedor.com"
SMTP_PORT="587"
SMTP_USER="tu_usuario_smtp"
SMTP_PASS="tu_password_smtp"
SMTP_FROM="noreply@nuevoleon.tecnm.mx"
```

### Frontend — `project_final/.env`

Crea el archivo `project_final/.env` (no existe aún):

```env
VITE_API_URL=https://api.tudominio.mx
```

> Este archivo se usa en tiempo de build. Sin él, el frontend apunta a `localhost:3000`.

---

## 3. Primer despliegue

```bash
# 1. Clonar el repositorio en el VPS
git clone <url-del-repo> /var/www/citas-tecnl
cd /var/www/citas-tecnl

# 2. Crear carpetas necesarias fuera del proyecto
mkdir -p /var/www/citas-tecnl/data
mkdir -p /var/www/citas-tecnl/uploads

# 3. Instalar dependencias del backend
cd server
npm install

# 4. Aplicar migraciones de base de datos
npx prisma migrate deploy

# 5. Generar cliente de Prisma
npx prisma generate

# 6. Iniciar el servidor con PM2
pm2 start npm --name "citas-backend" -- start
pm2 save
pm2 startup   # sigue las instrucciones que imprime para arranque automático

# 7. Build del frontend
cd ../project_final
npm install
npm run build
# El resultado queda en project_final/dist/ — sirve ese directorio con nginx
```

---

## 4. Crear el administrador inicial

> **No uses el seed en producción.** En su lugar, usa el script incluido.

```bash
cd /var/www/citas-tecnl/server

npx ts-node scripts/create-admin.ts admin@nuevoleon.tecnm.mx "TuContraseñaSegura" "Admin TECNL"
```

El script valida que el correo no esté duplicado e imprime confirmación. Cambia la contraseña desde el perfil al entrar por primera vez.

Para crear especialistas, usa el panel de administrador directamente desde la aplicación — se les enviará un correo de bienvenida con sus credenciales automáticamente.

---

## 5. Actualizar a una nueva versión

Cuando hagas cambios en tu PC y los subas con `git push`, para aplicarlos en el VPS:

```bash
cd /var/www/citas-tecnl

# 1. Descargar los cambios
git pull

# 2. Actualizar dependencias del backend (solo si cambiaron package.json)
cd server && npm install

# 3. Aplicar migraciones si hubo cambios en el schema de la BD
npx prisma migrate deploy

# 4. Reiniciar el servidor backend
pm2 restart citas-backend

# 5. Rebuild del frontend (siempre que haya cambios en project_final/)
cd ../project_final && npm install && npm run build
```

> Los archivos `.env` **no se tocan** en este proceso — persisten en el VPS entre actualizaciones.
> La base de datos tampoco se afecta — `migrate deploy` solo aplica migraciones nuevas, nunca borra datos.

---

## 6. Configurar backups automáticos

Con ~300 usuarios al año, un backup diario a las 2 AM es más que suficiente. Se conservan los últimos 30 días.

Todo se hace desde la terminal del VPS. Son **4 pasos en orden**:

---

### Paso 1 — Crear la carpeta donde se guardarán los backups

```bash
mkdir -p /var/www/citas-tecnl/backups
```

---

### Paso 2 — Crear el script de backup

Ejecuta este bloque completo de una sola vez en la terminal. Crea el archivo automáticamente sin necesidad de un editor:

```bash
cat > /usr/local/bin/backup-citas.sh << 'EOF'
#!/bin/bash
DB_PATH="/var/www/citas-tecnl/data/prod.db"
BACKUP_DIR="/var/www/citas-tecnl/backups"
FECHA=$(date +%Y-%m-%d)

sqlite3 "$DB_PATH" ".backup $BACKUP_DIR/backup-$FECHA.db"
find "$BACKUP_DIR" -name "backup-*.db" -mtime +30 -delete
echo "Backup completado: backup-$FECHA.db"
EOF
```

---

### Paso 3 — Dar permiso de ejecución y probar que funciona

```bash
# Dar permiso de ejecución al script
chmod +x /usr/local/bin/backup-citas.sh

# Ejecutarlo manualmente para comprobar que funciona
/usr/local/bin/backup-citas.sh
```

Deberías ver: `Backup completado: backup-2026-XX-XX.db`

Para confirmar que el archivo se creó:

```bash
ls -lh /var/www/citas-tecnl/backups/
```

---

### Paso 4 — Programar el backup automático diario

Este comando abre el editor de tareas programadas (cron):

```bash
crontab -e
```

La primera vez te pregunta qué editor usar — elige **1 (nano)**, es el más sencillo.

Se abrirá un archivo de texto. Ve al **final del archivo** y añade esta línea:

```
0 2 * * * /usr/local/bin/backup-citas.sh >> /var/log/backup-citas.log 2>&1
```

Luego guarda y cierra: `Ctrl+O` → `Enter` → `Ctrl+X`

Eso es todo. El backup correrá automáticamente **cada día a las 2:00 AM**.

---

### Verificar que el cron funciona (al día siguiente)

```bash
# Ver el historial de backups ejecutados
cat /var/log/backup-citas.log

# Ver los archivos de backup guardados
ls -lh /var/www/citas-tecnl/backups/
```

---

### Restaurar un backup (si fuera necesario)

```bash
# 1. Detener el servidor
pm2 stop citas-backend

# 2. Reemplazar la base de datos con el backup deseado (cambia la fecha)
cp /var/www/citas-tecnl/backups/backup-2026-03-21.db /var/www/citas-tecnl/data/prod.db

# 3. Reiniciar el servidor
pm2 start citas-backend
```

---

## 7. Configurar nginx + HTTPS

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
sudo nano /etc/nginx/sites-available/citas-tecnl
```

Contenido del archivo nginx:

```nginx
# Backend API
server {
    server_name api.tudominio.mx;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Archivos subidos (fotos, recursos)
    location /uploads/ {
        alias /var/www/citas-tecnl/uploads/;
        expires 30d;
        add_header Cache-Control "public";
    }
}

# Frontend
server {
    server_name citas.tudominio.mx;

    root /var/www/citas-tecnl/project_final/dist;
    index index.html;

    # SPA — todas las rutas apuntan al index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
# Activar el sitio
sudo ln -s /etc/nginx/sites-available/citas-tecnl /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Generar certificados SSL (HTTPS gratuito con Let's Encrypt)
sudo certbot --nginx -d api.tudominio.mx -d citas.tudominio.mx
```

---

## 8. Checklist final antes de ir a producción

### Backend `.env`
- [ ] `DATABASE_URL` apunta a `/var/www/citas-tecnl/data/prod.db`
- [ ] `ALLOWED_EMAIL_DOMAIN` = `nuevoleon.tecnm.mx`
- [ ] `BACKEND_URL` = URL pública real (https)
- [ ] `FRONTEND_URL` = URL pública real (https)
- [ ] `UPLOADS_PATH` = `/var/www/citas-tecnl/uploads`
- [ ] `SMTP_*` configurado con proveedor real
- [ ] `JWT_SECRET` generado con `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

### Frontend `.env`
- [ ] `VITE_API_URL` = URL pública del backend (https)
- [ ] Build generado con `npm run build` DESPUÉS de crear el `.env`

### Código
- [ ] Bloque de **cuentas de acceso rápido** eliminado de `LoginForm.tsx`
- [ ] Seed **NO ejecutado** en producción

### Infraestructura
- [ ] PM2 configurado y en arranque automático (`pm2 startup && pm2 save`)
- [ ] nginx corriendo con HTTPS activo
- [ ] Backup automático configurado y probado
- [ ] `.env` NO está en el repositorio (verificar `.gitignore`)

---

## Comandos útiles en producción

```bash
# Ver estado del servidor
pm2 status

# Ver logs en tiempo real
pm2 logs citas-backend

# Reiniciar tras actualización de código
cd /var/www/citas-tecnl/server && npm install && pm2 restart citas-backend

# Rebuild del frontend
cd /var/www/citas-tecnl/project_final && npm install && npm run build

# Aplicar nuevas migraciones de base de datos
cd /var/www/citas-tecnl/server && npx prisma migrate deploy
```
