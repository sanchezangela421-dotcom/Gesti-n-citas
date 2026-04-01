import { wrap, header, footer, ctaButton, infoBanner } from './base';

export function welcomeTemplate(
  name: string,
  email: string,
  password: string,
  role: string,
  loginUrl: string
): string {
  const roleLabel = role === 'admin' ? 'Administrador' : 'Especialista';

  return wrap(`
    ${header(`Cuenta de ${roleLabel}`)}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${name}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        El administrador del sistema ha creado una cuenta para ti en <strong>Synkros</strong>.
        A continuación encontrarás tus credenciales de acceso:
      </p>
      <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:24px 0;">
        <table style="width:100%;font-size:14px;border-collapse:collapse;">
          <tr>
            <td style="color:#64748b;padding:6px 0;font-weight:600;width:40%;">Correo:</td>
            <td style="color:#1e293b;padding:6px 0;">${email}</td>
          </tr>
          <tr>
            <td style="color:#64748b;padding:6px 0;font-weight:600;">Contraseña:</td>
            <td style="color:#1e293b;padding:6px 0;font-family:monospace;font-size:16px;letter-spacing:1px;">${password}</td>
          </tr>
          <tr>
            <td style="color:#64748b;padding:6px 0;font-weight:600;">Rol:</td>
            <td style="color:#1e293b;padding:6px 0;">${roleLabel}</td>
          </tr>
        </table>
      </div>
      ${infoBanner(
        '🔒 <strong>Recomendación de seguridad:</strong> Cambia tu contraseña desde el perfil de tu cuenta la primera vez que inicies sesión.',
        { bg: '#fefce8', border: '#fde68a', color: '#92400e' }
      )}
      ${ctaButton('Iniciar sesión', loginUrl)}
    </div>
    ${footer}
  `);
}
