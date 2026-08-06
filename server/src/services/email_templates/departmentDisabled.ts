import { wrap, header, footer, appointmentBox, ctaButton, infoBanner, escapeHtml } from './base';

interface DepartmentDisabledData {
  department: string;
  orgName: string;
  /** Cita ya agendada que SÍ se va a respetar, si la persona tiene alguna. */
  pending?: { date: string; time: string; specialistName: string };
  appUrl: string;
}

/**
 * Aviso al usuario: su organización dejó de ofrecer un departamento.
 *
 * El mensaje central es que la cita que ya tiene se respeta y que a partir de
 * este correo no podrá agendar más en ese departamento, para que nadie se
 * presente esperando una cita que ya no existe ni intente reservar en vano.
 */
export function departmentDisabledUserTemplate(
  userName: string,
  data: DepartmentDisabledData,
): string {
  return wrap(`
    ${header(`${data.department} deja de estar disponible`, 'linear-gradient(135deg,#78350f,#d97706)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${escapeHtml(userName)}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Te informamos que <strong>${escapeHtml(data.orgName)}</strong> dejará de ofrecer el servicio de
        <strong>${escapeHtml(data.department)}</strong> a través de <strong>Synkros</strong>.
        A partir de este aviso no será posible agendar nuevas citas en este departamento.
      </p>

      ${data.pending ? `
        ${infoBanner(
          'Tu cita ya agendada <strong>se mantiene sin cambios</strong>. Puedes asistir con normalidad.',
          { bg: '#ecfdf5', border: '#a7f3d0', color: '#065f46' }
        )}
        ${appointmentBox([
          { label: 'Especialista', value: data.pending.specialistName },
          { label: 'Fecha', value: data.pending.date, emphasis: 'highlight' },
          { label: 'Hora', value: data.pending.time, emphasis: 'highlight' },
        ])}
      ` : ''}

      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Los demás departamentos siguen disponibles con normalidad, y tu historial
        de citas anteriores se conserva en tu panel.
      </p>
      ${ctaButton('Ir a mi panel', data.appUrl, 'linear-gradient(135deg,#1e40af,#0369a1)')}
    </div>
    ${footer}
  `);
}

/**
 * Aviso al especialista del departamento retirado: conserva su acceso y su
 * agenda, pero deja de recibir solicitudes nuevas.
 */
export function departmentDisabledSpecialistTemplate(
  specialistName: string,
  data: { department: string; orgName: string; openAppointments: number; appUrl: string },
): string {
  return wrap(`
    ${header(`${data.department} deja de estar disponible`, 'linear-gradient(135deg,#78350f,#d97706)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${escapeHtml(specialistName)}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        <strong>${escapeHtml(data.orgName)}</strong> dejará de ofrecer el servicio de
        <strong>${escapeHtml(data.department)}</strong>. Desde ahora no recibirás solicitudes de cita nuevas.
      </p>
      ${infoBanner(
        data.openAppointments > 0
          ? `Conservas el acceso a tu panel y tus <strong>${data.openAppointments} cita(s) ya agendada(s)</strong> se mantienen: puedes atenderlas y cerrarlas con normalidad.`
          : 'Conservas el acceso a tu panel para consultar tu historial y los expedientes de tus pacientes.',
        { bg: '#ecfdf5', border: '#a7f3d0', color: '#065f46' }
      )}
      ${ctaButton('Ver mi agenda', data.appUrl, 'linear-gradient(135deg,#78350f,#d97706)')}
    </div>
    ${footer}
  `);
}
