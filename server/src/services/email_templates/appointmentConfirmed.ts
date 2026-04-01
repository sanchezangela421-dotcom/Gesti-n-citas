import { wrap, header, footer, appointmentBox, ctaButton, infoBanner } from './base';

interface ConfirmedData {
  date: string;
  time: string;
  specialistName: string;
  department: string;
  modality: string;
  meetingUrl?: string;
  appUrl: string;
}

/** Correo al alumno: cita confirmada */
export function appointmentConfirmedTemplate(studentName: string, data: ConfirmedData): string {
  const virtualBanner = data.meetingUrl
    ? infoBanner(
        `🎥 Tu cita es <strong>virtual</strong>. Guarda el enlace de la videollamada:<br/>
        <a href="${data.meetingUrl}" style="color:#1d4ed8;word-break:break-all;">${data.meetingUrl}</a>`,
        { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' }
      )
    : '';

  return wrap(`
    ${header('¡Tu cita está confirmada!', 'linear-gradient(135deg,#065f46,#0f766e)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${studentName}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Tu especialista ha confirmado tu cita en <strong>Synkros</strong>. ¡Ya está todo listo!
      </p>
      ${appointmentBox([
        { label: 'Especialista', value: data.specialistName },
        { label: 'Departamento', value: data.department },
        { label: 'Fecha', value: data.date },
        { label: 'Hora', value: data.time },
        { label: 'Modalidad', value: data.modality },
      ])}
      ${virtualBanner}
      ${ctaButton('Ver mis citas', data.appUrl, 'linear-gradient(135deg,#065f46,#0f766e)')}
    </div>
    ${footer}
  `);
}
