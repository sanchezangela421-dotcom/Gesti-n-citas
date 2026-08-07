const YEAR = new Date().getFullYear();

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sanea una URL para usar en un atributo href: solo permite http(s).
 *  Cualquier otro esquema (javascript:, data:, etc.) → '#'.
 *  El resultado debe escaparse igual (escapeHtml) antes de insertarlo en el HTML. */
export function safeUrl(url: string): string {
  const trimmed = (url ?? '').trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'http:' || u.protocol === 'https:') return trimmed;
  } catch { /* URL inválida */ }
  return '#';
}
// La imagen se envía como adjunto MIME (CID) para que funcione en todos los clientes
// sin depender de una URL pública. Ver email.ts → LOGO_ATTACHMENT.
const LOGO_CID = 'logo@synkros';

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
    <img src="cid:${LOGO_CID}" alt="Synkros" style="height:44px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto;" />
    <p style="color:rgba(255,255,255,0.75);margin:0;font-size:13px;">${subtitle}</p>
  </div>
`;

/** Énfasis visual de un valor. Se expresa como dato, NO como HTML del llamador:
 *  el marcado lo pone esta función, siempre alrededor del texto ya escapado. */
export type RowEmphasis = 'strike' | 'highlight';

/** Caja de detalles de cita — layout vertical (label encima, valor abajo).
 *
 *  El valor SIEMPRE se escapa. Antes existía un `raw: true` para insertar HTML
 *  ya montado (fechas tachadas o resaltadas al reagendar), pero esa vía dejaba
 *  la seguridad en manos de cada llamador: bastaba que alguien pasara un dato de
 *  usuario con `raw` para abrir una inyección. Ese hueco es también lo que hacía
 *  a CodeQL marcar todos los correos con datos de usuario como vulnerables, ya
 *  que no puede demostrar que ningún llamador use el atajo.
 *
 *  Ahora el énfasis se pide con `emphasis` y el marcado lo genera esta función,
 *  de modo que no existe ninguna ruta que llegue al HTML sin pasar por escapeHtml. */
export const appointmentBox = (rows: { label: string; value: string; emphasis?: RowEmphasis }[]) => `
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:24px 0;">
    ${rows.map((r, i) => {
      const safe = escapeHtml(r.value);
      const value =
        r.emphasis === 'strike'    ? `<s style="color:#94a3b8;">${safe}</s>` :
        r.emphasis === 'highlight' ? `<strong style="color:#0f766e;">${safe}</strong>` :
        safe;
      return `
      <div style="padding:8px 0;${i < rows.length - 1 ? 'border-bottom:1px solid #e2e8f0;' : ''}">
        <p style="color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 2px;">${escapeHtml(r.label)}</p>
        <p style="color:#1e293b;font-size:14px;margin:0;font-weight:500;">${value}</p>
      </div>
    `;
    }).join('')}
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
