# 🏥 Sistema de Gestión de Citas Institucionales - Panel Premium (v2.0)

Este ecosistema digital es una solución integral diseñada para optimizar los servicios de apoyo estudiantil. A través de una interfaz sofisticada y flujos de trabajo automatizados, conecta de manera eficiente a los estudiantes con especialistas en áreas críticas para su desarrollo académico y personal.

---

## 🧭 Módulos del Sistema

### 1. 🎓 Portal del Estudiante (Centro de Bienestar)
Diseñado para eliminar fricciones en la búsqueda de ayuda, el panel del alumno se enfoca en la accesibilidad y el acompañamiento.

-   **Dashboard dinámico**: 
    -   **Banner Curado**: Un carrusel inteligente con transiciones fluidas de 5 segundos que destaca eventos y avisos importantes.
    -   **Acceso Rápido**: Accesos directos a citas activas y recursos recientes.
-   **Appointment Wizard (Asistente de 3 Pasos)**:
    -   **Selección de Departamento**: Psicología, Tutorías y Nutrición con identificadores visuales únicos.
    -   **Filtro de Especialistas**: Listado dinámico basado en el departamento elegido.
    -   **Verificación de Disponibilidad**: Calendario interactivo que solo muestra días con horarios habilitados.
-   **Mis Recursos (Biblioteca Digital)**:
    -   Repositorio organizado por pestañas.
    -   Soporte para múltiples formatos: Infografías (imágenes), masterclasses (videos) y guías externas (enlaces).
-   **Seguridad en Gestión**:
    -   **Regla de las 24 Horas**: Restricción automatizada que evita cancelaciones de último minuto, garantizando el respeto al tiempo del especialista.

### 2. 🩺 Panel del Especialista (Consola Médica/Educativa)
Una herramienta de alta productividad para que los profesionales gestionen su tiempo y contenido sin distracciones.

-   **Agenda Unificada**: 
    -   Vista de calendario mensual con indicadores de días ocupados.
    -   Agenda diaria detallada al lado derecho, permitiendo ver pacientes y horarios de un vistazo.
-   **Gestión de Horarios (Flexible & Dinámica)**:
    -   Sistema de "Lápiz de Edición" para ajustar slots de tiempo existentes.
    -   Encabezados que muestran la fecha real de la semana actual para evitar confusiones.
    -   Anticipación recomendada de 1 semana integrada en la UI.
-   **Content Manager**:
    -   Formularios expandidos para publicar contenido educativo o eventos de manera inmediata.
-   **Seguimiento de Sesiones**:
    -   Control de estados: *Pendiente* -> *Confirmada* -> *Completada*.
    -   Espacio para notas internas por cita.

### 3. �️ Panel de Administración (Control Central)
La torre de control para supervisar la salud y el rendimiento de todos los departamentos.

-   **Analíticas en Tiempo Real**: 
    -   Tarjetas de métricas (KPIS) con gradientes de estado.
    -   Gráficas de distribución por departamento y motivos de consulta.
-   **Directorio de Profesionales**: 
    -   Alta y baja de especialistas.
    -   Monitoreo de carga de trabajo por departamento.
-   **Auditoría de Citas**: 
    -   Buscador global ultra-rápido por nombre de alumno o especialista.
    -   Filtros cruzados por departamento y estado de cita.

---

## 🛠️ Arquitectura Técnica

El proyecto ha sido construido bajo los más altos estándares de desarrollo moderno con React:

-   **State Management**: Utilización de **React Context API** (`StoreContext` y `AuthContext`) para una gestión de datos centralizada sin la sobrecarga de Redux. 
-   **Componentes Premium**: 
    -   **Tailwind CSS Custom System**: Una base de estilos consistentes con tokens de diseño para gradientes y sombras "WOW".
    -   **Lucide Icons**: Iconografía vectorial para una interfaz nítida en todas las resoluciones.
-   **Visualización**: **Recharts** para generar analíticas visuales que facilitan la toma de decisiones administrativas.
-   **Feedback de Usuario**: Animaciones con `framer-motion` (implícitos vía Tailwind) y notificaciones dinámicas con `sonner`.

---

## 📁 Estructura del Proyecto

```text
src/
├── app/
│   └── App.tsx           # Núcleo del sistema (Vistas, Lógica y Componentes)
├── main.tsx              # Punto de entrada de la aplicación
└── index.css             # Configuraciones globales de diseño y Tailwind
```

---

## � Guía de Instalación

1.  **Clonar y Acceder**:
    ```bash
    git clone [repo-url]
    cd proyecto-final
    ```
2.  **Instalar Dependencias**:
    ```bash
    npm install
    ```
3.  **Ambiente de Desarrollo**:
    ```bash
    npm run dev
    ```
4.  **Generar Compilación (Build)**:
    ```bash
    npm run build
    ```

---

## � Cuentas para Pruebas

Credenciales del seed de desarrollo (`server/prisma/seed.ts` — solo entorno local):

| Rol | Email | Password |
| :--- | :--- | :--- |
| **SuperAdmin** | `superadmin@gestioncitas.app` | `Admin1234` |
| **Administrador** | `admin@mail.com` | `Admin1234` |
| **Especialista** | `especialista@mail.com` | `Admin1234` |
| **Alumno** | `alumno@mail.com` | `Admin1234` |