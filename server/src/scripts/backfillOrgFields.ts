import { Prisma, PrismaClient } from '@prisma/client';
import { defaultFieldsForOrgType } from '../lib/registrationFields';

const prisma = new PrismaClient();

/**
 * Da de alta los campos de registro por defecto en las organizaciones que no
 * tienen ninguno.
 *
 * Hasta agosto de 2026 una organización nacía SIN campos: su formulario de
 * registro solo pedía nombre y correo, así que nunca se capturaba fecha de
 * nacimiento ni género y sus gráficas demográficas quedaban vacías para siempre.
 * Eso ya se corrigió al crear la organización, pero las que se dieron de alta
 * antes siguen sin campos, y desde el panel no hay forma de sembrarlos de golpe.
 *
 * Es ADITIVO e IDEMPOTENTE: solo toca organizaciones con cero campos, así que
 * nunca pisa una configuración que alguien haya hecho a mano. Correrlo dos veces
 * no cambia nada la segunda vez.
 *
 *   pnpm db:backfill-fields -- --dry-run   (solo informa)
 *   pnpm db:backfill-fields                (aplica)
 */
export interface BackfillResult {
  scanned: number;
  updated: string[];
}

export async function backfillOrgFields(
  opts: { dryRun?: boolean; log?: (msg: string) => void } = {},
): Promise<BackfillResult> {
  const dryRun = opts.dryRun ?? false;
  const log = opts.log ?? console.log;

  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      _count: { select: { registrationFields: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const pending = orgs.filter(o => o._count.registrationFields === 0);

  log(`Organizaciones: ${orgs.length} · sin campos de registro: ${pending.length}`);

  if (pending.length === 0) {
    log('✔ Nada que hacer: todas tienen al menos un campo.');
    return { scanned: orgs.length, updated: [] };
  }

  for (const org of pending) {
    const fields = defaultFieldsForOrgType(org.type);
    const keys = fields.map(f => f.key).join(', ');

    if (dryRun) {
      log(`  [dry-run] ${org.name} (${org.type}) ← ${keys}`);
      continue;
    }

    await prisma.registrationField.createMany({
      data: fields.map(f => ({
        organizationId: org.id,
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        order: f.order,
        options: f.options ?? Prisma.JsonNull,
        placeholder: f.placeholder,
      })),
      // Por si alguien corre el script en paralelo o una clave ya existiera.
      skipDuplicates: true,
    });

    log(`  ✔ ${org.name} (${org.type}) ← ${keys}`);
  }

  log(
    dryRun
      ? '\nNada se escribió. Repite el comando sin --dry-run para aplicar.'
      : `\n✔ Listo: ${pending.length} organización(es) actualizada(s).`,
  );

  return { scanned: orgs.length, updated: dryRun ? [] : pending.map(o => o.id) };
}

// Solo corre al invocarlo como script; importarlo desde una prueba no lo dispara.
if (require.main === module) {
  backfillOrgFields({ dryRun: process.argv.includes('--dry-run') })
    .catch(err => {
      console.error('✖ Error en el backfill de campos de registro:', err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
