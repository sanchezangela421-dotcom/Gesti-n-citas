/**
 * Fecha "YYYY-MM-DD" en la zona horaria LOCAL del servidor (TZ del contenedor).
 * Nunca usar toISOString() para obtener "hoy": siempre devuelve la fecha en UTC,
 * y a partir de las 18:00 hora de México eso ya es "mañana" — descuadraba el
 * filtro de horarios de hoy y el cierre automático de períodos.
 */
export function localISODate(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, '0')}-` +
    `${String(d.getDate()).padStart(2, '0')}`
  );
}

/** "2026-08-04" → "martes, 4 de agosto de 2026" (para correos y notificaciones) */
export function formatLongDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** "14:30" → "2:30 PM" */
export function formatTime12h(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
}
