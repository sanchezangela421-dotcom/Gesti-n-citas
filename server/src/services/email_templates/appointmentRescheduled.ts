import { wrap, header, footer, appointmentBox, ctaButton, infoBanner } from './base';

interface RescheduledData {
  previousDate: string;
  previousTime: string;
  newDate: string;
  newTime: string;
  modality: string;
  appUrl: string;
}

/** Correo al alumno: el especialista reagendó */
export function appointmentRescheduledStudentTemplate(
  studentName: string,
  specialistName: string,
  data: RescheduledData
): string {
  return wrap(`
    ${header('Tu cita fue reagendada', 'linear-gradient(135deg,#92400e,#d97706)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${studentName}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Tu especialista <strong>${specialistName}</strong> ha reagendado tu cita en
        <strong>Synkros</strong>. Revisa los nuevos datos a continuación.
      </p>
      <p style="color:#64748b;font-size:13px;font-weight:600;margin:20px 0 8px;">Fecha y hora anterior</p>
      ${appointmentBox([
        { label: 'Fecha', value: `<s style="color:#94a3b8;">${data.previousDate}</s>` },
        { label: 'Hora', value: `<s style="color:#94a3b8;">${data.previousTime}</s>` },
      ])}
      <p style="color:#64748b;font-size:13px;font-weight:600;margin:20px 0 8px;">Nueva fecha y hora</p>
      ${appointmentBox([
        { label: 'Fecha', value: `<strong style="color:#0f766e;">${data.newDate}</strong>` },
        { label: 'Hora', value: `<strong style="color:#0f766e;">${data.newTime}</strong>` },
        { label: 'Modalidad', value: data.modality },
      ])}
      ${infoBanner(
        'Si los nuevos horarios no te convienen puedes reagendar o cancelar la cita desde tu panel.',
        { bg: '#fffbeb', border: '#fde68a', color: '#92400e' }
      )}
      ${ctaButton('Ver mis citas', data.appUrl, 'linear-gradient(135deg,#92400e,#d97706)')}
    </div>
    ${footer}
  `);
}

/** Correo al especialista: el alumno reagendó */
export function appointmentRescheduledSpecialistTemplate(
  specialistName: string,
  studentName: string,
  data: RescheduledData
): string {
  return wrap(`
    ${header('Un alumno reagendó su cita', 'linear-gradient(135deg,#92400e,#d97706)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${specialistName}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        El alumno <strong>${studentName}</strong> ha reagendado su cita en
        <strong>Synkros</strong>. Tu agenda ha sido actualizada.
      </p>
      <p style="color:#64748b;font-size:13px;font-weight:600;margin:20px 0 8px;">Fecha y hora anterior</p>
      ${appointmentBox([
        { label: 'Fecha', value: `<s style="color:#94a3b8;">${data.previousDate}</s>` },
        { label: 'Hora', value: `<s style="color:#94a3b8;">${data.previousTime}</s>` },
      ])}
      <p style="color:#64748b;font-size:13px;font-weight:600;margin:20px 0 8px;">Nueva fecha y hora</p>
      ${appointmentBox([
        { label: 'Alumno', value: studentName },
        { label: 'Fecha', value: `<strong style="color:#0f766e;">${data.newDate}</strong>` },
        { label: 'Hora', value: `<strong style="color:#0f766e;">${data.newTime}</strong>` },
        { label: 'Modalidad', value: data.modality },
      ])}
      ${ctaButton('Ver mi agenda', data.appUrl, 'linear-gradient(135deg,#92400e,#d97706)')}
    </div>
    ${footer}
  `);
}
