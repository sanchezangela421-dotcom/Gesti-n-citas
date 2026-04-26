/**
 * Returns "YYYY-MM-DD" in LOCAL timezone — prevents the UTC-offset off-by-one
 * that happens when calling toISOString() on a Date with a time component.
 * Use this everywhere a date string in YYYY-MM-DD format is needed.
 */
export function localISODate(d: Date): string {
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

/** Calcula la edad actual a partir de una fecha de nacimiento "YYYY-MM-DD". */
export function calcularEdad(fechaNacimiento: string): number {
  const hoy = new Date();
  const nac = new Date(fechaNacimiento + "T12:00:00");
  let edad = hoy.getFullYear() - nac.getFullYear();
  const cumpleEsteAnio = new Date(hoy.getFullYear(), nac.getMonth(), nac.getDate());
  if (hoy < cumpleEsteAnio) edad--;
  return edad;
}
