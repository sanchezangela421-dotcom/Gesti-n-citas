import { wrap, header, footer, appointmentBox, ctaButton, infoBanner } from './base';

interface ReminderData {
  date: string;
  time: string;
  modality: string;
  department?: string;
  meetingUrl?: string;
  appUrl: string;
}

/** Recordatorio 24h al alumno */
export function appointmentReminderStudentTemplate(
  studentName: string,
  specialistName: string,
  data: ReminderData
): string {
  const virtualBanner = data.meetingUrl
    ? infoBanner(
        `🎥 Tu cita es <strong>virtual</strong>. Enlace de videollamada:<br/>
        <a href="${data.meetingUrl}" style="color:#1d4ed8;word-break:break-all;">${data.meetingUrl}</a>`,
        { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' }
      )
    : '';

  return wrap(`
    ${header('Recuerda: tienes una cita mañana', 'linear-gradient(135deg,#1e3a5f,#4c1d95)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${studentName}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Te recordamos que tienes una cita programada para <strong>mañana</strong> en
        <strong>Synkros</strong>. ¡No olvides prepararla con tiempo!
      </p>
      ${appointmentBox([
        { label: 'Especialista', value: specialistName },
        ...(data.department ? [{ label: 'Departamento', value: data.department }] : []),
        { label: 'Fecha', value: data.date },
        { label: 'Hora', value: data.time },
        { label: 'Modalidad', value: data.modality },
      ])}
      ${virtualBanner}
      ${ctaButton('Ver mis citas', data.appUrl, 'linear-gradient(135deg,#1e3a5f,#4c1d95)')}
    </div>
    ${footer}
  `);
}

/** Recordatorio 24h al especialista */
export function appointmentReminderSpecialistTemplate(
  specialistName: string,
  studentName: string,
  data: ReminderData
): string {
  return wrap(`
    ${header('Recuerda: tienes una cita mañana', 'linear-gradient(135deg,#1e3a5f,#4c1d95)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${specialistName}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Te recordamos que tienes una cita programada para <strong>mañana</strong> en
        <strong>Synkros</strong>.
      </p>
      ${appointmentBox([
        { label: 'Alumno', value: studentName },
        { label: 'Fecha', value: data.date },
        { label: 'Hora', value: data.time },
        { label: 'Modalidad', value: data.modality },
      ])}
      ${ctaButton('Ver mi agenda', data.appUrl, 'linear-gradient(135deg,#1e3a5f,#4c1d95)')}
    </div>
    ${footer}
  `);
}
