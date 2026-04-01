import { wrap, header, footer, appointmentBox, ctaButton, infoBanner } from './base';

interface CancelledData {
  date: string;
  time: string;
  modality: string;
  reason?: string;
  appUrl: string;
}

/** Correo al alumno: el especialista canceló */
export function appointmentCancelledStudentTemplate(
  studentName: string,
  specialistName: string,
  data: CancelledData
): string {
  return wrap(`
    ${header('Tu cita fue cancelada', 'linear-gradient(135deg,#7f1d1d,#dc2626)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${studentName}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Lamentablemente tu especialista <strong>${specialistName}</strong> ha cancelado
        la siguiente cita en <strong>Synkros</strong>.
      </p>
      ${appointmentBox([
        { label: 'Especialista', value: specialistName },
        { label: 'Fecha', value: data.date },
        { label: 'Hora', value: data.time },
        { label: 'Modalidad', value: data.modality },
        ...(data.reason ? [{ label: 'Motivo', value: data.reason }] : []),
      ])}
      ${infoBanner(
        'Puedes agendar una nueva cita cuando lo necesites desde tu panel de <strong>Synkros</strong>.',
        { bg: '#fef2f2', border: '#fecaca', color: '#991b1b' }
      )}
      ${ctaButton('Agendar nueva cita', data.appUrl, 'linear-gradient(135deg,#1e40af,#0369a1)')}
    </div>
    ${footer}
  `);
}

/** Correo al especialista: el alumno canceló */
export function appointmentCancelledSpecialistTemplate(
  specialistName: string,
  studentName: string,
  data: CancelledData
): string {
  return wrap(`
    ${header('Un alumno canceló su cita', 'linear-gradient(135deg,#7f1d1d,#dc2626)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${specialistName}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        El alumno <strong>${studentName}</strong> ha cancelado su cita en
        <strong>Synkros</strong>. El horario ha quedado libre en tu agenda.
      </p>
      ${appointmentBox([
        { label: 'Alumno', value: studentName },
        { label: 'Fecha', value: data.date },
        { label: 'Hora', value: data.time },
        { label: 'Modalidad', value: data.modality },
        ...(data.reason ? [{ label: 'Motivo', value: data.reason }] : []),
      ])}
      ${ctaButton('Ver mi agenda', data.appUrl, 'linear-gradient(135deg,#7f1d1d,#dc2626)')}
    </div>
    ${footer}
  `);
}
