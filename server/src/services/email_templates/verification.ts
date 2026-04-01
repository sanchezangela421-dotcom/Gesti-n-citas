import { wrap, header, footer, ctaButton, infoBanner } from './base';

export function verificationTemplate(name: string, verifyUrl: string): string {
  return wrap(`
    ${header('Verificación de correo institucional')}
    <div style="padding:32px;">
      <p style="color:#334155;font-size:15px;">Hola <strong>${name}</strong>,</p>
      <p style="color:#475569;font-size:14px;line-height:1.6;">
        Gracias por registrarte en <strong>Synkros</strong>. Para activar tu cuenta y comenzar
        a agendar citas, confirma tu dirección de correo electrónico.
      </p>
      ${ctaButton('Verificar mi correo', verifyUrl)}
      ${infoBanner('Este enlace expira en <strong>24 horas</strong>. Si no creaste esta cuenta, puedes ignorar este mensaje.')}
    </div>
    ${footer}
  `);
}
