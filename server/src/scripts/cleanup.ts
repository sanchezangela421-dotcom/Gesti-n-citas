import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Iniciando LIMPIEZA TOTAL de base de datos...');

  try {
    // Orden de borrado para respetar llaves foráneas
    await prisma.notification.deleteMany();
    console.log('- Notificaciones eliminadas');

    await prisma.resource.deleteMany();
    console.log('- Recursos eliminados');

    await prisma.appEvent.deleteMany();
    console.log('- Eventos eliminados');

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
  } finally {
    await prisma.$disconnect();
  }
}

main();
