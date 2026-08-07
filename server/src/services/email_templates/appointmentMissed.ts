import { wrap, header, footer, appointmentBox, ctaButton, infoBanner, escapeHtml } from './base';

interface MissedData {
  date: string;
  time: string;
  specialistName: string;
  department: string;
  appUrl: string;
}

/**
 * Aviso al usuario de que su cita se cerró como inasistencia.
 *
 * El tono es deliberadamente no punitivo. Este sistema atiende salud mental, y
 * faltar a una sesión suele ser síntoma de que la persona está pasando por algo
 * —no un descuido que haya que reprochar—. El correo cumple dos funciones:
 * que sepa que la cita ya no está en pie (si no, la seguiría dando por válida)
 * y dejarle abierta la puerta para volver a agendar.
 *
 * Por eso no se usa rojo ni la palabra "falta": el color es neutro y el mensaje
 * invita, no señala.
 */
export function appointmentMissedTemplate(userName: string, data: MissedData): string {
  return wrap(`
    ${header('Sobre tu cita', 'linear-gradient(135deg,#1e3a5f,#0f766e)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${escapeHtml(userName)}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Notamos que no pudiste acompañarnos en tu cita, así que la cerramos en el sistema.
      </p>

      ${appointmentBox([
        { label: 'Especialista', value: data.specialistName },
        { label: 'Departamento', value: data.department },
        { label: 'Fecha', value: data.date },
        { label: 'Hora', value: data.time },
      ])}

      ${infoBanner(
        'Entendemos que a veces se atraviesan cosas. Si quieres retomarlo, puedes agendar una nueva cita cuando te venga bien — sin ningún inconveniente.',
        { bg: '#eff6ff', border: '#bfdbfe', color: '#1e40af' }
      )}

      ${ctaButton('Agendar una nueva cita', data.appUrl, 'linear-gradient(135deg,#1e40af,#0369a1)')}
    </div>
    ${footer}
  `);
}
