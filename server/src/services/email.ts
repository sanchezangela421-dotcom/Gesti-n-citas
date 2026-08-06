import nodemailer from 'nodemailer';
import path from 'path';
import { verificationTemplate } from './email_templates/verification';
import { passwordResetTemplate } from './email_templates/passwordReset';
import { welcomeTemplate } from './email_templates/welcome';
import {
  appointmentNewStudentTemplate,
  appointmentNewSpecialistTemplate,
} from './email_templates/appointmentNew';
import { appointmentConfirmedTemplate } from './email_templates/appointmentConfirmed';
import {
  appointmentRescheduledStudentTemplate,
  appointmentRescheduledSpecialistTemplate,
} from './email_templates/appointmentRescheduled';
import {
  appointmentCancelledStudentTemplate,
  appointmentCancelledSpecialistTemplate,
} from './email_templates/appointmentCancelled';
import {
  appointmentReminderStudentTemplate,
  appointmentReminderSpecialistTemplate,
} from './email_templates/appointmentReminder';
import { accountInvitationTemplate } from './email_templates/accountInvitation';
import {
  departmentDisabledUserTemplate,
  departmentDisabledSpecialistTemplate,
} from './email_templates/departmentDisabled';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = `"Synkros" <${process.env.SMTP_FROM}>`;
const APP_URL = process.env.FRONTEND_URL ?? '';

// Adjunto inline CID — el logo viaja con el correo sin depender de URL pública.
// El template usa src="cid:logo@synkros" en el <img>.
const LOGO_ATTACHMENT = {
  filename: 'logo.png',
  path: path.join(__dirname, 'email_templates', 'logo-light.png'),
  cid: 'logo@synkros',
};

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function sendVerificationEmail(name: string, email: string, token: string) {
  const verifyUrl = `${process.env.BACKEND_URL}/api/auth/verify/${token}`;
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Verifica tu correo — Synkros',
    html: verificationTemplate(name, verifyUrl),
    attachments: [LOGO_ATTACHMENT],
  });
}

export async function sendPasswordResetEmail(name: string, email: string, token: string) {
  const resetUrl = `${APP_URL}?reset_token=${token}`;
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Recupera tu contraseña — Synkros',
    html: passwordResetTemplate(name, resetUrl),
    attachments: [LOGO_ATTACHMENT],
  });
}

export async function sendWelcomeEmail(name: string, email: string, password: string, role: string) {
  const roleLabel = role === 'admin' ? 'Administrador' : 'Especialista';
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `Bienvenido/a a Synkros — ${roleLabel}`,
    html: welcomeTemplate(name, email, password, role, APP_URL),
    attachments: [LOGO_ATTACHMENT],
  });
}

export async function sendAccountInvitation(
  name: string, email: string, orgName: string, role: string, activationUrl: string
) {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `Activa tu cuenta en Synkros — ${orgName}`,
    html: accountInvitationTemplate(name, orgName, role, activationUrl),
    attachments: [LOGO_ATTACHMENT],
  });
}

// ── Appointments ──────────────────────────────────────────────────────────────

export interface AppointmentEmailData {
  date: string;
  time: string;
  specialistName: string;
  studentName: string;
  department: string;
  modality: string;
  reason?: string;
  meetingUrl?: string;
  location?: string;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Nueva solicitud: avisa al alumno (recibida) y al especialista (pendiente) */
export async function sendAppointmentNewEmails(
  studentEmail: string,
  specialistEmail: string,
  data: AppointmentEmailData
) {
  await transporter.sendMail({
    from: FROM,
    to: studentEmail,
    subject: 'Solicitud de cita recibida — Synkros',
    html: appointmentNewStudentTemplate(data.studentName, { ...data, appUrl: APP_URL }),
    attachments: [LOGO_ATTACHMENT],
  });
  await delay(1100);
  await transporter.sendMail({
    from: FROM,
    to: specialistEmail,
    subject: `Nueva solicitud de cita de ${data.studentName} — Synkros`,
    html: appointmentNewSpecialistTemplate(data.specialistName, { ...data, appUrl: APP_URL }),
    attachments: [LOGO_ATTACHMENT],
  });
}

/** Cita confirmada: solo al alumno */
export async function sendAppointmentConfirmedEmail(
  studentEmail: string,
  data: AppointmentEmailData
) {
  await transporter.sendMail({
    from: FROM,
    to: studentEmail,
    subject: '¡Tu cita está confirmada! — Synkros',
    html: appointmentConfirmedTemplate(data.studentName, { ...data, appUrl: APP_URL }),
    attachments: [LOGO_ATTACHMENT],
  });
}

/** Reagendado por el especialista: avisa al alumno */
export async function sendRescheduledBySpecialistEmail(
  studentEmail: string,
  data: AppointmentEmailData & { previousDate: string; previousTime: string; newDate: string; newTime: string }
) {
  await transporter.sendMail({
    from: FROM,
    to: studentEmail,
    subject: 'Tu cita fue reagendada — Synkros',
    html: appointmentRescheduledStudentTemplate(data.studentName, data.specialistName, {
      previousDate: data.previousDate,
      previousTime: data.previousTime,
      newDate: data.newDate,
      newTime: data.newTime,
      modality: data.modality,
      appUrl: APP_URL,
    }),
    attachments: [LOGO_ATTACHMENT],
  });
}

/** Reagendado por el alumno: avisa al especialista */
export async function sendRescheduledByStudentEmail(
  specialistEmail: string,
  data: AppointmentEmailData & { previousDate: string; previousTime: string; newDate: string; newTime: string }
) {
  await transporter.sendMail({
    from: FROM,
    to: specialistEmail,
    subject: `${data.studentName} reagendó su cita — Synkros`,
    html: appointmentRescheduledSpecialistTemplate(data.specialistName, data.studentName, {
      previousDate: data.previousDate,
      previousTime: data.previousTime,
      newDate: data.newDate,
      newTime: data.newTime,
      modality: data.modality,
      appUrl: APP_URL,
    }),
    attachments: [LOGO_ATTACHMENT],
  });
}

/** Cancelado por el especialista: avisa al alumno */
export async function sendCancelledBySpecialistEmail(
  studentEmail: string,
  data: AppointmentEmailData & { reason?: string }
) {
  await transporter.sendMail({
    from: FROM,
    to: studentEmail,
    subject: 'Tu cita fue cancelada — Synkros',
    html: appointmentCancelledStudentTemplate(data.studentName, data.specialistName, {
      date: data.date,
      time: data.time,
      modality: data.modality,
      reason: data.reason,
      appUrl: APP_URL,
    }),
    attachments: [LOGO_ATTACHMENT],
  });
}

/** Cancelado por el alumno: avisa al especialista */
export async function sendCancelledByStudentEmail(
  specialistEmail: string,
  data: AppointmentEmailData & { reason?: string }
) {
  await transporter.sendMail({
    from: FROM,
    to: specialistEmail,
    subject: `${data.studentName} canceló su cita — Synkros`,
    html: appointmentCancelledSpecialistTemplate(data.specialistName, data.studentName, {
      date: data.date,
      time: data.time,
      modality: data.modality,
      reason: data.reason,
      appUrl: APP_URL,
    }),
    attachments: [LOGO_ATTACHMENT],
  });
}

/** Recordatorio 24h: avisa a ambos */
export async function sendAppointmentReminderEmails(
  studentEmail: string,
  specialistEmail: string,
  data: AppointmentEmailData
) {
  await transporter.sendMail({
    from: FROM,
    to: studentEmail,
    subject: 'Recordatorio: tienes una cita mañana — Synkros',
    html: appointmentReminderStudentTemplate(data.studentName, data.specialistName, {
      date: data.date,
      time: data.time,
      modality: data.modality,
      department: data.department,
      meetingUrl: data.meetingUrl,
      appUrl: APP_URL,
    }),
    attachments: [LOGO_ATTACHMENT],
  });
  await delay(1100);
  await transporter.sendMail({
    from: FROM,
    to: specialistEmail,
    subject: `Recordatorio: cita con ${data.studentName} mañana — Synkros`,
    html: appointmentReminderSpecialistTemplate(data.specialistName, data.studentName, {
      date: data.date,
      time: data.time,
      modality: data.modality,
      appUrl: APP_URL,
    }),
    attachments: [LOGO_ATTACHMENT],
  });
}

// ── Departamentos ─────────────────────────────────────────────────────────────

/** Aviso al usuario: su organización retira un departamento. Su cita se respeta. */
export async function sendDepartmentDisabledUserEmail(
  email: string,
  userName: string,
  data: {
    department: string;
    orgName: string;
    pending?: { date: string; time: string; specialistName: string };
  },
) {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `${data.department} deja de estar disponible — Synkros`,
    html: departmentDisabledUserTemplate(userName, { ...data, appUrl: APP_URL }),
    attachments: [LOGO_ATTACHMENT],
  });
}

/** Aviso al especialista: deja de recibir citas, pero conserva agenda y acceso. */
export async function sendDepartmentDisabledSpecialistEmail(
  email: string,
  specialistName: string,
  data: { department: string; orgName: string; openAppointments: number },
) {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `${data.department} deja de estar disponible — Synkros`,
    html: departmentDisabledSpecialistTemplate(specialistName, { ...data, appUrl: APP_URL }),
    attachments: [LOGO_ATTACHMENT],
  });
}
