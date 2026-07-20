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
