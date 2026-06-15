import { User, Specialist, Appointment, AppEvent, Resource, AppNotification } from '../types';

export const SEED_USERS: User[] = [
  { id: "u1", email: "admin@instituto.edu.mx", password: "admin123", name: "Admin Sistema", role: "admin" },
  { id: "u2", email: "alumno@instituto.edu.mx", password: "alumno123", name: "María García López", role: "alumno", matricula: "20210001", carrera: "Ing. en Sistemas Computacionales", semestre: 5, fechaNacimiento: "2003-03-15", genero: "Femenino" },
  { id: "u3", email: "psicologo@instituto.edu.mx", password: "esp123", name: "Dr. Carlos Mendoza", role: "especialista", department: "Psicología" },
  { id: "u4", email: "tutor@instituto.edu.mx", password: "esp123", name: "Mtra. Ana Ruiz", role: "especialista", department: "Tutorías" },
  { id: "u5", email: "nutriologo@instituto.edu.mx", password: "esp123", name: "Lic. Roberto Sánchez", role: "especialista", department: "Nutrición" },
];

export const SEED_SPECIALISTS: Specialist[] = [
  {
    id: "s1", userId: "u3", name: "Dr. Carlos Mendoza", department: "Psicología", email: "psicologo@instituto.edu.mx", active: true,
    schedule: [{ id: "ss1", dayOfWeek: 1, startTime: "09:00", endTime: "10:00", available: true }, { id: "ss2", dayOfWeek: 1, startTime: "10:00", endTime: "11:00", available: true }, { id: "ss3", dayOfWeek: 1, startTime: "11:00", endTime: "12:00", available: true }, { id: "ss4", dayOfWeek: 3, startTime: "09:00", endTime: "10:00", available: true }, { id: "ss5", dayOfWeek: 3, startTime: "10:00", endTime: "11:00", available: true }, { id: "ss6", dayOfWeek: 5, startTime: "14:00", endTime: "15:00", available: true }, { id: "ss7", dayOfWeek: 5, startTime: "15:00", endTime: "16:00", available: true }]
  },
  {
    id: "s2", userId: "u4", name: "Mtra. Ana Ruiz", department: "Tutorías", email: "ana.ruiz@instituto.edu.mx", active: true,
    schedule: [{ id: "ss8", dayOfWeek: 2, startTime: "08:00", endTime: "09:00", available: true }, { id: "ss9", dayOfWeek: 2, startTime: "09:00", endTime: "10:00", available: true }, { id: "ss10", dayOfWeek: 4, startTime: "10:00", endTime: "11:00", available: true }, { id: "ss11", dayOfWeek: 4, startTime: "11:00", endTime: "12:00", available: true }]
  },
  {
    id: "s3", userId: "u5", name: "Lic. Roberto Sánchez", department: "Nutrición", email: "roberto.s@instituto.edu.mx", active: true,
    schedule: [{ id: "ss12", dayOfWeek: 1, startTime: "13:00", endTime: "14:00", available: true }, { id: "ss13", dayOfWeek: 1, startTime: "14:00", endTime: "15:00", available: true }, { id: "ss14", dayOfWeek: 3, startTime: "13:00", endTime: "14:00", available: true }, { id: "ss15", dayOfWeek: 5, startTime: "09:00", endTime: "10:00", available: true }]
  },
];

export const SEED_APPOINTMENTS: Appointment[] = [
  { id: "a1", studentId: "u2", studentName: "María García López", specialistId: "s1", specialistName: "Dr. Carlos Mendoza", department: "Psicología", date: "2026-03-16", time: "09:00", status: "Confirmada", modality: "Presencial", motivo: "Estrés académico y ansiedad", createdAt: "2026-03-01T10:00:00Z" },
  { id: "a2", studentId: "u2", studentName: "María García López", specialistId: "s2", specialistName: "Mtra. Ana Ruiz", department: "Tutorías", date: "2026-03-18", time: "09:00", status: "Pendiente", modality: "Virtual", motivo: "Asesoría en materias de programación", createdAt: "2026-03-02T14:00:00Z" },
  { id: "a3", studentId: "u2", studentName: "María García López", specialistId: "s1", specialistName: "Dr. Carlos Mendoza", department: "Psicología", date: "2026-02-10", time: "10:00", status: "Completada", modality: "Presencial", motivo: "Orientación vocacional", createdAt: "2026-02-01T08:00:00Z" },
  { id: "a4", studentId: "u2", studentName: "María García López", specialistId: "s2", specialistName: "Mtra. Ana Ruiz", department: "Tutorías", date: "2026-01-22", time: "10:00", status: "Completada", modality: "Virtual", motivo: "Planificación académica", createdAt: "2026-01-15T08:00:00Z" },
];

export const SEED_EVENTS: AppEvent[] = [
  { id: "e1", title: "Taller: Manejo del Estrés Académico", description: "Técnicas efectivas para manejar el estrés. Ejercicios de respiración y mindfulness.", department: "Psicología", date: "2026-03-15", time: "10:00", type: "taller", imageUrl: "https://images.unsplash.com/photo-1607551848581-7ee851bf978b?w=400&q=80" },
  { id: "e2", title: "Feria de Nutrición Saludable", description: "Evaluaciones nutricionales gratuitas, tips de alimentación balanceada.", department: "Nutrición", date: "2026-03-20", time: "09:00", type: "taller", imageUrl: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&q=80" },
  { id: "e3", title: "Tutoría Grupal: Matemáticas y Cálculo", description: "Sesión abierta para resolver dudas de cálculo diferencial y álgebra lineal.", department: "Tutorías", date: "2026-03-18", time: "14:00", type: "taller", imageUrl: "https://images.unsplash.com/photo-1509062522246-3755977927d7?w=400&q=80" },
  { id: "e4", title: "Conferencia: Salud Mental en la Universidad", description: "Ponencia sobre salud mental y rendimiento académico.", department: "Psicología", date: "2026-03-25", time: "11:00", type: "conferencia", imageUrl: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=400&q=80" },
];

export const SEED_RESOURCES: Resource[] = [
  { id: "r1", department: "Psicología", type: "image", title: "Infografía: Técnicas de Relajación", description: "Guía con 5 técnicas de respiración para momentos de estrés.", url: "#", imageUrl: "https://images.unsplash.com/photo-1607551848581-7ee851bf978b?w=400&q=80" },
  { id: "r2", department: "Psicología", type: "video", title: "Video: Manejo de la Ansiedad", description: "Sesión grabada con ejercicios prácticos.", url: "#" },
  { id: "r3", department: "Psicología", type: "link", title: "Test de Ansiedad en Línea", description: "Autoevaluación confidencial. Resultados inmediatos.", url: "#" },
  { id: "r4", department: "Tutorías", type: "image", title: "Infografía: Técnicas de Estudio Efectivo", description: "Métodos probados: Pomodoro, Cornell, mapas mentales.", url: "#", imageUrl: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400&q=80" },
  { id: "r5", department: "Tutorías", type: "link", title: "Guía de Planificación Académica", description: "Herramienta para organizar tu semestre y horarios de estudio.", url: "#" },
  { id: "r6", department: "Tutorías", type: "video", title: "Video: Cómo preparar un examen", description: "Estrategias para estudiar de forma eficiente.", url: "#" },
  { id: "r7", department: "Nutrición", type: "image", title: "Infografía: Plan Alimenticio Estudiantil", description: "Opciones de comidas balanceadas, económicas y rápidas.", url: "#", imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&q=80" },
  { id: "r8", department: "Nutrición", type: "video", title: "Video: Hidratación y Rendimiento", description: "Cómo la hidratación afecta tu concentración académica.", url: "#" },
  { id: "r9", department: "Nutrición", type: "link", title: "Calculadora de Calorías", description: "Herramienta interactiva para necesidades calóricas diarias.", url: "#" },
];

export const CHART_MONTHLY = [
  { month: "Ene", Psicología: 45, Tutorías: 38, Nutrición: 22 },
  { month: "Feb", Psicología: 52, Tutorías: 42, Nutrición: 28 },
  { month: "Mar", Psicología: 38, Tutorías: 35, Nutrición: 18 },
];
export const CHART_MOTIVOS = [{ name: "Ansiedad", value: 35 }, { name: "Estrés académico", value: 28 }, { name: "Orientación vocacional", value: 20 }, { name: "Alimentación", value: 17 }];
export const CHART_MODALIDAD = [{ name: "Presencial", value: 65 }, { name: "Virtual", value: 35 }];
export const CHART_CARRERA = [{ name: "Ing. Sistemas", value: 42 }, { name: "Ing. Industrial", value: 28 }, { name: "Administración", value: 20 }, { name: "Contaduría", value: 15 }, { name: "Otros", value: 10 }];
export const PIE_COLORS = ["#2563EB", "#16A34A", "#EA580C", "#8b5cf6", "#ec4899"];

export const SEED_NOTIFICATIONS: Record<string, AppNotification[]> = {
  u1: [
    { id: "d1", title: "Nuevo especialista", message: "Se agregó a Lic. Fernanda Torres al departamento de Nutrición.", time: "Hace 30 min", read: false, type: "new_user" },
    { id: "d2", title: "Reporte generado", message: "El reporte mensual de Psicología fue generado exitosamente.", time: "Hace 2 horas", read: false, type: "report" },
  ],
  u2: [
    { id: "a1", title: "Cita confirmada", message: "Tu cita de Nutrición del 6 de marzo ha sido confirmada.", time: "Hace 10 min", read: false, type: "confirmed" },
    { id: "a2", title: "Recordatorio de cita", message: "Tienes una cita mañana a las 10:00 con Mtra. Ana Ruiz.", time: "Hace 2 horas", read: false, type: "reminder" },
  ],
  u3: [
    { id: "e1", title: "Nueva cita agendada", message: "María García López solicitó cita para el 6 de marzo a las 09:00.", time: "Hace 15 min", read: false, type: "confirmed" },
  ]
};

export const ROLE_NOTIFICATIONS: Record<string, AppNotification[]> = {
  alumno: [
    { id: "a1", title: "Cita confirmada", message: "Tu cita de Nutrición del 6 de marzo ha sido confirmada.", time: "Hace 10 min", read: false, type: "confirmed" },
    { id: "a2", title: "Recordatorio de cita", message: "Tienes una cita mañana a las 10:00 con Mtra. Ana Ruiz.", time: "Hace 2 horas", read: false, type: "reminder" },
    { id: "a3", title: "Nuevo taller disponible", message: "Taller: Manejo del Estrés Académico — Psicología, 15 de marzo.", time: "Hace 1 día", read: true, type: "event" },
    { id: "a4", title: "Reagendamiento exitoso", message: "Tu cita de Tutorías fue reagendada al 10 de marzo a las 11:00.", time: "Hace 2 días", read: true, type: "reschedule" },
  ],
  especialista: [
    { id: "e1", title: "Nueva cita agendada", message: "María García López solicitó cita para el 6 de marzo a las 09:00.", time: "Hace 15 min", read: false, type: "confirmed" },
    { id: "e2", title: "Cita reagendada", message: "Luis Hernández reagendó su cita del 5 al 10 de marzo.", time: "Hace 1 hora", read: false, type: "reschedule" },
    { id: "e3", title: "Recordatorio", message: "Tienes 3 citas programadas para mañana.", time: "Hace 4 horas", read: true, type: "reminder" },
    { id: "e4", title: "Cita cancelada", message: "Pedro Sánchez canceló su cita del 7 de marzo.", time: "Hace 1 día", read: true, type: "cancelled" },
  ],
  admin: [
    { id: "d1", title: "Nuevo especialista", message: "Se agregó a Lic. Fernanda Torres al departamento de Nutrición.", time: "Hace 30 min", read: false, type: "new_user" },
    { id: "d2", title: "Reporte generado", message: "El reporte mensual de Psicología fue generado exitosamente.", time: "Hace 2 horas", read: false, type: "report" },
    { id: "d3", title: "Alta actividad", message: "Psicología registró 15 citas esta semana, un 20% más que la anterior.", time: "Hace 1 día", read: true, type: "reminder" },
    { id: "d4", title: "Evento publicado", message: "Se publicó el taller 'Manejo del Estrés' para el 15 de marzo.", time: "Hace 2 días", read: true, type: "event" },
  ],
};
