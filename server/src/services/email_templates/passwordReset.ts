import { wrap, header, footer, ctaButton, infoBanner } from './base';

export function passwordResetTemplate(name: string, resetUrl: string): string {
  return wrap(`
    ${header('Recuperación de contraseña', 'linear-gradient(135deg,#4c1d95,#2563eb)')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${name}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Recibimos una solicitud para restablecer la contraseña de tu cuenta en
        <strong>Synkros</strong>. Haz clic en el botón para crear una nueva contraseña.
      </p>
      ${ctaButton('Restablecer contraseña', resetUrl, 'linear-gradient(135deg,#7c3aed,#2563eb)')}
      ${infoBanner(
        'Este enlace expira en <strong>1 hora</strong>. Si no solicitaste este cambio, puedes ignorar este mensaje con seguridad.',
        { bg: '#faf5ff', border: '#e9d5ff', color: '#6b21a8' }
      )}
    </div>
    ${footer}
  `);
}
