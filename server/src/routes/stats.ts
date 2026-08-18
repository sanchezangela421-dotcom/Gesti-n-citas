import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { orgScope } from '../lib/orgScope';
import { MISSED } from './appointments';
import { contractedDepartments } from '../lib/departments';
import { legacyOrMetadata, comparableKey } from '../lib/registrationFields';

const router = Router();

const UNSPECIFIED_CAREER = 'Otras / No especificada';
const UNSPECIFIED = 'No especificado';

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                     'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const AGE_RANGES = [
  { label: '15–17', min: 15, max: 17 },
  { label: '18–20', min: 18, max: 20 },
  { label: '21–23', min: 21, max: 23 },
  { label: '24–26', min: 24, max: 26 },
  { label: '27+',   min: 27, max: 199 },
];

/**
 * Campos con gráfica dedicada, que por eso NO se grafican de forma genérica:
 * duplicarían la que ya existe. Se comparan en forma normalizada porque la
 * organización pudo nombrar el campo "Género" y guardarse como "género".
 */
const FIELDS_WITH_OWN_CHART = new Set(
  ['carrera', 'genero', 'semestre', 'fechaNacimiento'].map(comparableKey),
);

/** Edad cumplida a partir de una fecha "YYYY-MM-DD". */
function ageFrom(birthDate: string): number | null {
  const born = new Date(`${birthDate}T12:00:00`);
  if (isNaN(born.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  const birthdayThisYear = new Date(today.getFullYear(), born.getMonth(), born.getDate());
  if (today < birthdayThisYear) age--;
  return age;
}

interface StudentDemographics {
  carrera: string;
  genero: string;
  semestre: string;
  ageRange: string | null;
  metadata: Record<string, unknown> | null;
}

type ApptRow = {
  date: string;
  department: string;
  motivo: string;
  modality: string;
  status: string;
  studentId: string;
  isFollowUp: boolean;
};

type Distribution = { name: string; value: number }[];

/** Cuenta ocurrencias y las devuelve ordenadas de mayor a menor. */
function tally(values: string[], limit?: number): Distribution {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const rows = Object.entries(counts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  return limit ? rows.slice(0, limit) : rows;
}

/**
 * Bloque completo de estadísticas de un conjunto de citas.
 *
 * Vive en el servidor —y no en cada pantalla— porque antes el panel de admin se
 * traía TODAS las citas y TODOS los usuarios para calcular esto en el navegador,
 * y el PDF repetía la misma lógica por su cuenta. Eran tres implementaciones del
 * mismo cálculo (aquí, la pantalla y el reporte) que podían discrepar, y además
 * obligaban a que el listado de citas no se pudiera paginar.
 */
function buildBlock(
  appts: ApptRow[],
  demographicsByStudent: Map<string, StudentDemographics>,
  groupableFields: { key: string; label: string }[],
  departments: string[],
) {
  const demoOf = (studentId: string) => demographicsByStudent.get(studentId);

  // ── Gráfica mensual — "Mes YYYY" para no colisionar entre años ────────────
  const monthlyMap: Record<string, Record<string, number | string>> = {};
  const monthlySort: Record<string, number> = {};
  for (const a of appts) {
    const d = new Date(`${a.date}T12:00:00`);
    if (isNaN(d.getTime())) continue;
    const key = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    if (!monthlyMap[key]) {
      monthlyMap[key] = { month: key };
      for (const dept of departments) monthlyMap[key][dept] = 0;
      monthlySort[key] = d.getFullYear() * 100 + d.getMonth();
    }
    if (typeof monthlyMap[key][a.department] === 'number') {
      monthlyMap[key][a.department] = (monthlyMap[key][a.department] as number) + 1;
    }
  }
  const monthly = Object.keys(monthlyMap)
    .sort((x, y) => monthlySort[x] - monthlySort[y])
    .map(k => monthlyMap[k]);

  // ── Distribuciones por los campos propios de la organización ──────────────
  const byField = groupableFields
    .map(field => {
      let withValue = 0;
      const values = appts.map(a => {
        const meta = demoOf(a.studentId)?.metadata;
        const raw = meta && typeof meta === 'object'
          ? (meta as Record<string, unknown>)[field.key]
          : undefined;
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (value) withValue++;
        return value || UNSPECIFIED;
      });
      // Si NADIE tiene valor la gráfica solo diría "No especificado" para todos,
      // y mostrar eso es peor que no mostrar nada: parece un dato real.
      if (withValue === 0) return null;
      return { key: field.key, label: field.label, data: tally(values, 8) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const countStatus = (status: string) => appts.filter(a => a.status === status).length;

  return {
    summary: {
      total: appts.length,
      pendientes: countStatus('Pendiente'),
      confirmadas: countStatus('Confirmada'),
      completadas: countStatus('Completada'),
      canceladas: countStatus('Cancelada'),
      noAsistio: countStatus(MISSED),
      seguimientos: appts.filter(a => a.isFollowUp).length,
    },
    charts: {
      monthly,
      motivos: tally(appts.map(a => a.motivo || 'Consulta General'), 8),
      modalidad: tally(appts.map(a => a.modality || 'No especificada')),
      // Se cuentan CITAS, no personas distintas: el resto de las gráficas de este
      // endpoint cuentan citas y mezclarlo daba dos números para lo mismo.
      carrera: tally(appts.map(a => demoOf(a.studentId)?.carrera ?? UNSPECIFIED_CAREER), 8),
      genero: tally(appts.map(a => demoOf(a.studentId)?.genero ?? UNSPECIFIED)),
      semestre: tally(appts.map(a => demoOf(a.studentId)?.semestre ?? 'No esp.'))
        .sort((a, b) => {
          const na = parseInt(a.name.replace('Sem. ', '')) || 99;
          const nb = parseInt(b.name.replace('Sem. ', '')) || 99;
          return na - nb;
        }),
      // Rangos siempre completos y en orden etario, aunque alguno venga en cero:
      // un histograma con huecos se lee como si faltaran datos.
      edad: AGE_RANGES.map(r => ({
        name: r.label,
        value: appts.filter(a => demoOf(a.studentId)?.ageRange === r.label).length,
      })),
      byField,
    },
  };
}

// GET /api/stats?periodId=<id>
// Sin periodId devuelve todos los períodos; "unassigned" devuelve las citas sin período.
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const { periodId } = req.query;
    const scope = orgScope(req.user);
    const where: any = periodId === 'unassigned'
      ? { ...scope, periodId: null }
      : periodId
        ? { ...scope, periodId: periodId as string }
        : { ...scope };

    // Proyección mínima: solo las columnas que alimentan alguna gráfica.
    const appts: ApptRow[] = await prisma.appointment.findMany({
      where,
      select: {
        date: true, department: true, motivo: true,
        modality: true, status: true, studentId: true, isFollowUp: true,
      },
    });

    const organizationId = req.user?.organizationId ?? null;

    const [org, fields, students] = await Promise.all([
      organizationId
        ? prisma.organization.findUnique({
            where: { id: organizationId },
            select: { departments: true },
          })
        : Promise.resolve(null),
      organizationId
        ? prisma.registrationField.findMany({
            where: { organizationId },
            orderBy: { order: 'asc' },
            select: { key: true, label: true, type: true },
          })
        : Promise.resolve([]),
      prisma.user.findMany({
        where: { id: { in: [...new Set(appts.map(a => a.studentId))] } },
        select: {
          id: true, carrera: true, genero: true,
          semestre: true, fechaNacimiento: true, metadata: true,
        },
      }),
    ]);

    const departments = contractedDepartments(org);

    // Solo los campos de conjunto cerrado sirven para agrupar: hacerlo por un
    // texto libre daría una barra por respuesta.
    const groupableFields = fields
      .filter(f => (f.type === 'select' || f.type === 'radio')
        && !FIELDS_WITH_OWN_CHART.has(comparableKey(f.key)))
      .map(f => ({ key: f.key, label: f.label }));

    // Se resuelve UNA vez por alumno y no una vez por cita: un alumno con veinte
    // citas repetía veinte veces la misma búsqueda difusa sobre su metadata.
    const demographicsByStudent = new Map<string, StudentDemographics>(
      students.map(s => {
        const birth = legacyOrMetadata(s, 'fechaNacimiento');
        const age = birth ? ageFrom(birth) : null;
        const semestre = legacyOrMetadata(s, 'semestre');
        return [s.id, {
          carrera: legacyOrMetadata(s, 'carrera') ?? UNSPECIFIED_CAREER,
          genero: legacyOrMetadata(s, 'genero') ?? UNSPECIFIED,
          semestre: semestre ? `Sem. ${semestre}` : 'No esp.',
          ageRange: age === null
            ? null
            : AGE_RANGES.find(r => age >= r.min && age <= r.max)?.label ?? null,
          metadata: (s.metadata ?? null) as Record<string, unknown> | null,
        }];
      }),
    );

    const global = buildBlock(appts, demographicsByStudent, groupableFields, departments);

    // Un bloque por departamento contratado, con la misma forma que el global:
    // así la pantalla y el PDF consumen la misma estructura sea cual sea la vista.
    const byDepartment: Record<string, ReturnType<typeof buildBlock>> = {};
    for (const dept of departments) {
      byDepartment[dept] = buildBlock(
        appts.filter(a => a.department === dept),
        demographicsByStudent,
        groupableFields,
        [dept],
      );
    }

    res.json({
      summary: {
        ...global.summary,
        byDept: Object.fromEntries(
          departments.map(d => [d, byDepartment[d].summary.total]),
        ),
      },
      charts: global.charts,
      byDepartment,
      departments,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
