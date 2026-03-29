import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM = `"Sistema de Citas TECNL" <${process.env.SMTP_FROM}>`;
const YEAR = new Date().getFullYear();

const footer = `
  <div style="background:#f1f5f9;padding:16px;text-align:center;">
    <p style="color:#94a3b8;font-size:11px;margin:0;">
      © ${YEAR} Tecnológico de Nuevo León — Sistema de Citas
    </p>
  </div>
`;

const header = (subtitle: string) => `
  <div style="background:linear-gradient(135deg,#1e3a5f,#0f766e);padding:32px;text-align:center;">
    <h1 style="color:white;margin:0;font-size:22px;">Sistema de Citas TECNL</h1>
    <p style="color:#99f6e4;margin:8px 0 0;font-size:13px;">${subtitle}</p>
  </div>
`;

// ── Verification email ────────────────────────────────────
export async function sendVerificationEmail(name: string, email: string, token: string) {
  const verifyUrl = `${process.env.BACKEND_URL}/api/auth/verify/${token}`;

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Verifica tu correo — Sistema de Citas TECNL',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f8fafc;border-radius:16px;overflow:hidden;">
        ${header('Verificación de correo institucional')}
        <div style="padding:32px;">
          <p style="color:#334155;font-size:15px;">Hola <strong>${name}</strong>,</p>
          <p style="color:#475569;font-size:14px;line-height:1.6;">
            Gracias por registrarte. Para activar tu cuenta y comenzar a agendar citas,
            confirma tu dirección de correo electrónico haciendo clic en el botón de abajo.
          </p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${verifyUrl}"
               style="background:linear-gradient(135deg,#2563eb,#0f766e);color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">
              Verificar mi correo
            </a>
          </div>
          <p style="color:#94a3b8;font-size:12px;text-align:center;font-style:italic;">
            Este enlace expira en <strong style="color:#64748b;">24 horas</strong>.<br/>
            Si no creaste esta cuenta, puedes ignorar este mensaje con seguridad.
          </p>
        </div>
        ${footer}
      </div>
    `,
  });
}

// ── Password reset email ──────────────────────────────────
export async function sendPasswordResetEmail(name: string, email: string, token: string) {
  const resetUrl = `${process.env.FRONTEND_URL}?reset_token=${token}`;

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Recupera tu contraseña — Sistema de Citas TECNL',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f8fafc;border-radius:16px;overflow:hidden;">
        ${header('Recuperación de contraseña')}
        <div style="padding:32px;">
          <p style="color:#334155;font-size:15px;">Hola <strong>${name}</strong>,</p>
          <p style="color:#475569;font-size:14px;line-height:1.6;">
            Recibimos una solicitud para restablecer la contraseña de tu cuenta.
            Haz clic en el botón de abajo para crear una nueva contraseña.
          </p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${resetUrl}"
               style="background:linear-gradient(135deg,#7c3aed,#2563eb);color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">
              Restablecer contraseña
            </a>
          </div>
          <p style="color:#94a3b8;font-size:12px;text-align:center;font-style:italic;">
            Este enlace expira en <strong style="color:#64748b;">1 hora</strong>.<br/>
            Si no solicitaste este cambio, puedes ignorar este mensaje con seguridad.
          </p>
        </div>
        ${footer}
      </div>
    `,
  });
}

// ── Welcome email (admin-created specialist/admin) ────────
export async function sendWelcomeEmail(name: string, email: string, password: string, role: string) {
  const roleLabel = role === 'admin' ? 'Administrador' : 'Especialista';
  const loginUrl = process.env.FRONTEND_URL;

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `Bienvenido/a al Sistema de Citas TECNL — ${roleLabel}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f8fafc;border-radius:16px;overflow:hidden;">
        ${header(`Cuenta de ${roleLabel}`)}
        <div style="padding:32px;">
          <p style="color:#334155;font-size:15px;">Hola <strong>${name}</strong>,</p>
          <p style="color:#475569;font-size:14px;line-height:1.6;">
            El administrador del sistema ha creado una cuenta para ti en el
            <strong>Sistema de Citas TECNL</strong>. A continuación encontrarás tus credenciales de acceso:
          </p>
          <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:24px 0;">
            <table style="width:100%;font-size:14px;border-collapse:collapse;">
              <tr>
                <td style="color:#64748b;padding:6px 0;font-weight:bold;width:40%;">Correo:</td>
                <td style="color:#1e293b;padding:6px 0;">${email}</td>
              </tr>
              <tr>
                <td style="color:#64748b;padding:6px 0;font-weight:bold;">Contraseña:</td>
                <td style="color:#1e293b;padding:6px 0;font-family:monospace;font-size:16px;letter-spacing:1px;">${password}</td>
              </tr>
              <tr>
                <td style="color:#64748b;padding:6px 0;font-weight:bold;">Rol:</td>
                <td style="color:#1e293b;padding:6px 0;">${roleLabel}</td>
              </tr>
            </table>
          </div>
          <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
            <p style="color:#92400e;font-size:13px;margin:0;">
              🔒 <strong>Recomendación de seguridad:</strong> Por favor cambia tu contraseña desde el perfil de tu cuenta la primera vez que inicies sesión.
            </p>
          </div>
          <div style="text-align:center;">
            <a href="${loginUrl}"
               style="background:linear-gradient(135deg,#2563eb,#0f766e);color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">
              Iniciar sesión
            </a>
          </div>
        </div>
        ${footer}
      </div>
    `,
  });
}
