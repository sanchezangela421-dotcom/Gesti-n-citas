/**
 * Campos de registro definidos por cada organización (`RegistrationField`).
 *
 * Los valores que captura el formulario viven en `User.metadata`, con la clave
 * que la organización le haya puesto al campo. Además hay cinco columnas legacy
 * en `User` (carrera, semestre, matricula, fechaNacimiento, genero) que nacieron
 * con TECNL y de las que todavía leen los reportes.
 *
 * El problema que resuelve este módulo: la clave se normaliza al guardarla
 * (`fechaNacimiento` → `fechanacimiento`), pero el volcado a las columnas legacy
 * la buscaba en camelCase. Nunca coincidía, así que toda organización creada
 * desde el panel se quedaba sin fecha de nacimiento ni género, y sus gráficas
 * demográficas salían vacías para siempre.
 */

/**
 * Normaliza la clave con la que se GUARDA un campo.
 *
 * Es la forma canónica y debe usarse tanto al crear el campo como al comprobar
 * duplicados: si el chequeo y la escritura normalizan distinto, el pre-chequeo
 * deja pasar una clave que luego revienta contra el índice único de la base.
 */
export function normalizeFieldKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Forma agresiva usada solo para COMPARAR claves, nunca para guardarlas:
 * minúsculas, sin acentos y sin separadores. Hace equivalentes a
 * `fechaNacimiento`, `fecha_nacimiento` y `Fecha Nacimiento`.
 */
export function comparableKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas diacriticas combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Variantes aceptadas por cada columna legacy.
 *
 * La comparación ignora acentos y separadores, así que aquí solo hacen falta las
 * formas que difieren en PALABRAS (p. ej. "fecha de nacimiento" lleva un "de"
 * que ninguna normalización puede adivinar).
 */
const LEGACY_FIELD_ALIASES = {
  fechaNacimiento: ['fechaNacimiento', 'fecha de nacimiento', 'nacimiento', 'fecha nac'],
  genero: ['genero', 'sexo'],
  carrera: ['carrera'],
  semestre: ['semestre'],
  matricula: ['matricula', 'numero de control', 'num control', 'no control'],
} as const;

export type LegacyField = keyof typeof LEGACY_FIELD_ALIASES;

/**
 * Busca en `metadata` el valor de un campo legacy, sin importar cómo haya
 * escrito la clave quien configuró la organización.
 */
export function metadataValue(metadata: unknown, field: LegacyField): string | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;

  const wanted = new Set<string>(
    LEGACY_FIELD_ALIASES[field].map(comparableKey),
  );

  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (!wanted.has(comparableKey(key))) continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

/**
 * Valor efectivo de un campo demográfico: primero la columna legacy y, si viene
 * vacía, el campo dinámico equivalente. Es el mismo respaldo que ya aplicaba
 * `careerOf` en las estadísticas, generalizado a los cinco campos.
 */
export function legacyOrMetadata(
  user: { metadata?: unknown } & Partial<Record<LegacyField, unknown>>,
  field: LegacyField,
): string | undefined {
  const direct = user[field];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (typeof direct === 'number') return String(direct);
  return metadataValue(user.metadata, field);
}

/**
 * Campos que se dan de alta con cada organización nueva.
 *
 * Una organización recién creada no tenía NINGÚN campo, así que su formulario de
 * registro no pedía nada y sus gráficas demográficas nacían vacías sin que
 * nadie lo notara hasta revisar un reporte. Fecha de nacimiento y género son
 * agnósticos al giro (aplican a una escuela, un hospital y una empresa por
 * igual); el identificador sí cambia según el tipo.
 *
 * Las claves se declaran ya normalizadas, para que coincidan con lo que
 * escribiría el panel y no dependan de este archivo para leerse.
 */
export interface DefaultField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  order: number;
  options: string[] | null;
  placeholder: string | null;
}

const UNIVERSAL_FIELDS: DefaultField[] = [
  { key: 'fechanacimiento', label: 'Fecha de Nacimiento', type: 'date', required: false, order: 90, options: null, placeholder: null },
  { key: 'genero', label: 'Género', type: 'radio', required: false, order: 91, options: ['Masculino', 'Femenino', 'Prefiero no decirlo'], placeholder: null },
];

const IDENTIFIER_BY_TYPE: Record<string, DefaultField> = {
  school: { key: 'matricula', label: 'Número de Control', type: 'text', required: false, order: 1, options: null, placeholder: 'Ej. 20210001' },
  hospital: { key: 'expediente', label: 'Número de Expediente', type: 'text', required: false, order: 1, options: null, placeholder: 'Ej. EXP-00123' },
  company: { key: 'numero_empleado', label: 'Número de Empleado', type: 'text', required: false, order: 1, options: null, placeholder: 'Ej. EMP-0042' },
};

export function defaultFieldsForOrgType(type: string): DefaultField[] {
  const identifier = IDENTIFIER_BY_TYPE[type];
  return identifier ? [identifier, ...UNIVERSAL_FIELDS] : [...UNIVERSAL_FIELDS];
}
