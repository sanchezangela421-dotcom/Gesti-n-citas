import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding...');
  
  // Clean up
  await prisma.notification.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.appEvent.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.scheduleSlot.deleteMany();
  await prisma.specialist.deleteMany();
  await prisma.user.deleteMany();
  
  // Hash password helper
  const hash = async (pwd: string) => {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(pwd, salt);
  };

  const adminPwd = await hash("admin123");
  const alumnoPwd = await hash("alumno123");
  const espPwd = await hash("esp123");

  // 1. Users
  const u1 = await prisma.user.create({
    data: { id: "u1", email: "admin@instituto.edu.mx", password: adminPwd, name: "Admin Sistema", role: "admin", emailVerified: true }
  });
  const u2 = await prisma.user.create({
    data: { id: "u2", email: "alumno@mail.com", password: alumnoPwd, name: "María García López", role: "alumno", matricula: "20210001", carrera: "Ing. en Sistemas Computacionales", semestre: 5, edad: 21, genero: "Femenino", emailVerified: true }
  });
  const u3 = await prisma.user.create({
    data: { id: "u3", email: "psicologo@instituto.edu.mx", password: espPwd, name: "Dr. Carlos Mendoza", role: "especialista", department: "Psicología", emailVerified: true }
  });
  const u4 = await prisma.user.create({
    data: { id: "u4", email: "tutor@instituto.edu.mx", password: espPwd, name: "Mtra. Ana Ruiz", role: "especialista", department: "Tutorías", emailVerified: true }
  });
  const u5 = await prisma.user.create({
    data: { id: "u5", email: "nutriologo@instituto.edu.mx", password: espPwd, name: "Lic. Roberto Sánchez", role: "especialista", department: "Nutrición", emailVerified: true }
  });

  // 2. Specialists (linked to their users, no schedules)
  await prisma.specialist.create({
    data: { id: "s1", userId: "u3", name: "Dr. Carlos Mendoza", department: "Psicología", email: "psicologo@instituto.edu.mx", active: true }
  });
  await prisma.specialist.create({
    data: { id: "s2", userId: "u4", name: "Mtra. Ana Ruiz", department: "Tutorías", email: "tutor@instituto.edu.mx", active: true }
  });
  await prisma.specialist.create({
    data: { id: "s3", userId: "u5", name: "Lic. Roberto Sánchez", department: "Nutrición", email: "nutriologo@instituto.edu.mx", active: true }
  });

  console.log('Seeding finished.');
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
