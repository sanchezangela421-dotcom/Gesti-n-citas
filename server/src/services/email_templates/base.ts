const YEAR = new Date().getFullYear();
const LOGO_URL = `${process.env.FRONTEND_URL}/logo-light.png`;

export const footer = `
  <div style="background:#f1f5f9;padding:24px 32px;text-align:center;border-top:2px solid #e2e8f0;">
    <p style="color:#64748b;font-size:12px;margin:0 0 8px;font-weight:600;">
      © ${YEAR} Instituto Tecnológico de Nuevo León — Synkros
    </p>
    <div style="display:inline-block;background:#e2e8f0;border-radius:6px;padding:6px 14px;margin-top:2px;">
      <p style="color:#475569;font-size:11px;margin:0;">
        Este es un mensaje automático, por favor no respondas a este correo.
      </p>
    </div>
  </div>
`;

export const header = (subtitle: string, accentGradient = 'linear-gradient(135deg,#1e3a5f,#0f766e)') => `
  <div style="background:${accentGradient};padding:28px 32px;text-align:center;">
    <img src="${LOGO_URL}" alt="Synkros" style="height:44px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
    <p style="color:rgba(255,255,255,0.75);margin:0;font-size:13px;">${subtitle}</p>
  </div>
`;

/** Caja de detalles de cita — layout vertical (label encima, valor abajo) */
export const appointmentBox = (rows: { label: string; value: string }[]) => `
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:24px 0;">
    ${rows.map((r, i) => `
      <div style="padding:8px 0;${i < rows.length - 1 ? 'border-bottom:1px solid #e2e8f0;' : ''}">
        <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 2px;">${r.label}</p>
        <p style="color:#1e293b;font-size:14px;margin:0;font-weight:500;">${r.value}</p>
      </div>
    `).join('')}
  </div>
`;

/** Botón CTA centrado */
export const ctaButton = (label: string, url: string, gradient = 'linear-gradient(135deg,#2563eb,#0f766e)') => `
  <div style="text-align:center;margin:28px 0;">
    <a href="${url}"
       style="background:${gradient};color:white;padding:14px 32px;border-radius:10px;
              text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
      ${label}
    </a>
  </div>
`;

/** Banner informativo */
export const infoBanner = (
  text: string,
  { bg = '#eff6ff', border = '#bfdbfe', color = '#1e40af' } = {}
) => `
  <div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:14px 18px;margin:20px 0;">
    <p style="color:${color};font-size:13px;margin:0;line-height:1.5;">${text}</p>
  </div>
`;

/** Wrapper exterior */
export const wrap = (content: string) => `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#f8fafc;
              border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
    ${content}
  </div>
`;
