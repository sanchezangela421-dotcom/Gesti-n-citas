import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Reset de la base de datos para DESARROLLO.
 *
 * Este script borra notas clínicas, cosa que en producción es ilegal (retención
 * NOM-004). Por eso lleva dos seguros: se niega a correr con NODE_ENV=production
 * y exige la bandera explícita --yes-borrar-expedientes. La aplicación nunca
 * ejecuta este código: las bajas de personas son lógicas (deletedAt).
 */
async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('⛔ Este script NO puede ejecutarse en producción: borra expedientes clínicos (retención NOM-004).');
    process.exitCode = 1;
    return;
  }

  if (!process.argv.includes('--yes-borrar-expedientes')) {
    console.error('⛔ Operación destructiva: elimina TODAS las notas clínicas y citas.');
    console.error('   Si estás en un entorno de desarrollo y estás seguro, repite el comando con:');
    console.error('   pnpm db:cleanup -- --yes-borrar-expedientes');
    process.exitCode = 1;
    return;
  }

  console.log('🧹 Iniciando LIMPIEZA TOTAL de base de datos (entorno de desarrollo)...');

  try {
    await prisma.notification.deleteMany();
    console.log('- Notificaciones eliminadas');

    await prisma.resource.deleteMany();
    console.log('- Recursos eliminados');

    await prisma.eventRegistration.deleteMany();
    await prisma.appEvent.deleteMany();
    console.log('- Eventos e inscripciones eliminados');

    // Orden obligatorio: las FKs del expediente son RESTRICT, así que las notas
    // (y sus revisiones) tienen que irse ANTES que las citas que las referencian.
    await prisma.clinicalNoteRevision.deleteMany();
    await prisma.clinicalNote.deleteMany();
    console.log('- Notas clínicas y revisiones eliminadas');

    await prisma.appointment.deleteMany();
    console.log('- Citas eliminadas');

    await prisma.scheduleSlot.deleteMany();
    console.log('- Horarios eliminados');

    await prisma.specialist.deleteMany();
    console.log('- Especialistas eliminados');

    // Conservar admins y superadmins por ROL (no por email hardcodeado: el filtro
    // anterior apuntaba a un correo que ya no existe y borraba las cuentas reales)
    const deletedUsers = await prisma.user.deleteMany({
      where: {
        role: { notIn: [UserRole.admin, UserRole.superadmin] }
      }
    });
    console.log(`- ${deletedUsers.count} Usuarios eliminados (se conservan admins y superadmins)`);

    console.log('\n✅ Base de datos reseteada a estado casi-cero.');
    console.log('💡 Para repoblar datos de prueba: pnpm db:seed (server/prisma/seed.ts).');
  } catch (error) {
    console.error('❌ Error durante la limpieza:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
