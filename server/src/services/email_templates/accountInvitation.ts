import { wrap, header, footer, ctaButton, infoBanner } from './base';

const ROLE_LABEL: Record<string, string> = {
  alumno:      'Alumno',
  especialista:'Especialista',
  admin:       'Administrador',
};

export function accountInvitationTemplate(
  name: string,
  orgName: string,
  role: string,
  activationUrl: string
): string {
  const roleLabel = ROLE_LABEL[role] ?? role;
  return wrap(`
    ${header('Invitación a la plataforma', 'linear-gradient(135deg,#1e3a5f,#0f766e)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${name}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Se ha creado una cuenta para ti en <strong>Synkros</strong> como
        <strong>${roleLabel}</strong> en la organización <strong>${orgName}</strong>.
      </p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Haz clic en el botón para activar tu cuenta y elegir tu contraseña.
      </p>
      ${ctaButton('Activar mi cuenta', activationUrl, 'linear-gradient(135deg,#0f766e,#2563eb)')}
      ${infoBanner(
        'Este enlace expira en <strong>72 horas</strong>. Si no esperabas este correo, puedes ignorarlo.',
        { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534' }
      )}
    </div>
    ${footer}
  `);
}
