import { wrap, header, footer, appointmentBox, ctaButton, infoBanner } from './base';

interface NewAppointmentData {
  date: string;       // ej. "Lunes 31 de marzo de 2026"
  time: string;       // ej. "10:00 AM"
  specialistName: string;
  department: string;
  modality: string;   // "Presencial" | "Virtual"
  reason?: string;
  appUrl: string;
}

/** Correo al alumno: solicitud recibida */
export function appointmentNewStudentTemplate(studentName: string, data: NewAppointmentData): string {
  return wrap(`
    ${header('Solicitud de cita recibida', 'linear-gradient(135deg,#1e40af,#0369a1)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${studentName}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Tu solicitud de cita ha sido recibida en <strong>Synkros</strong>.
        Te notificaremos en cuanto el especialista la confirme.
      </p>
      ${appointmentBox([
        { label: 'Especialista', value: data.specialistName },
        { label: 'Departamento', value: data.department },
        { label: 'Fecha', value: data.date },
        { label: 'Hora', value: data.time },
        { label: 'Modalidad', value: data.modality },
        ...(data.reason ? [{ label: 'Motivo', value: data.reason }] : []),
      ])}
      ${infoBanner('Tu cita está <strong>pendiente de confirmación</strong>. Recibirás otro correo cuando el especialista la acepte.')}
      ${ctaButton('Ver mis citas', data.appUrl)}
    </div>
    ${footer}
  `);
}

/** Correo al especialista: nueva solicitud */
export function appointmentNewSpecialistTemplate(specialistName: string, data: NewAppointmentData & { studentName: string }): string {
  return wrap(`
    ${header('Nueva solicitud de cita', 'linear-gradient(135deg,#1e40af,#0369a1)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${specialistName}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Tienes una nueva solicitud de cita en <strong>Synkros</strong>.
        Por favor confirma o rechaza la solicitud desde tu panel.
      </p>
      ${appointmentBox([
        { label: 'Alumno', value: data.studentName },
        { label: 'Fecha', value: data.date },
        { label: 'Hora', value: data.time },
        { label: 'Modalidad', value: data.modality },
        ...(data.reason ? [{ label: 'Motivo', value: data.reason }] : []),
      ])}
      ${ctaButton('Revisar solicitud', data.appUrl, 'linear-gradient(135deg,#1e40af,#0369a1)')}
    </div>
    ${footer}
  `);
}
