import { describe, it, expect } from 'vitest';
import { appointmentBox, escapeHtml, safeUrl } from '../src/services/email_templates/base';
import {
  appointmentCancelledStudentTemplate,
  appointmentCancelledSpecialistTemplate,
} from '../src/services/email_templates/appointmentCancelled';
import { appointmentConfirmedTemplate } from '../src/services/email_templates/appointmentConfirmed';
import {
  appointmentNewStudentTemplate,
  appointmentNewSpecialistTemplate,
} from '../src/services/email_templates/appointmentNew';
import {
  appointmentRescheduledStudentTemplate,
  appointmentRescheduledSpecialistTemplate,
} from '../src/services/email_templates/appointmentRescheduled';

/**
 * Los correos se arman con plantillas de texto, así que cualquier dato que
 * escriba una persona (nombre, motivo de cancelación, sede…) se interpola en
 * HTML. Si algo llega sin escapar, queda inyección almacenada en el buzón de
 * quien recibe el aviso.
 *
 * Se comprueba que el payload EXACTO no sobreviva literal. Dos formas más
 * obvias de escribir esto dan falsos positivos:
 *   · buscar `onerror=` — sobrevive intacto dentro de texto ya escapado;
 *   · buscar `<img ` — la cabecera de todas las plantillas lleva el logo en un
 *     <img> legítimo.
 */

const PAYLOAD = '<script>alert(1)</script>';
const injected = (html: string) => html.includes(PAYLOAD);

const base = { date: 'martes 5', time: '10:00 AM', modality: 'Virtual', appUrl: 'http://localhost' };

describe('escapeHtml', () => {
  it('neutraliza los metacaracteres de HTML', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml(`"'`)).toBe('&quot;&#39;');
  });
});

describe('appointmentBox no admite HTML del llamador', () => {
  it('escapa el valor siempre', () => {
    const html = appointmentBox([{ label: 'Motivo', value: PAYLOAD }]);
    expect(injected(html)).toBe(false);
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapa también la etiqueta', () => {
    const html = appointmentBox([{ label: PAYLOAD, value: 'x' }]);
    expect(injected(html)).toBe(false);
  });

  it('aplica el énfasis SOBRE el texto ya escapado, sin abrir una vía de inyección', () => {
    const strike = appointmentBox([{ label: 'Fecha', value: PAYLOAD, emphasis: 'strike' }]);
    expect(injected(strike)).toBe(false);
    expect(strike).toContain('<s style="color:#94a3b8;">&lt;script&gt;');

    const high = appointmentBox([{ label: 'Fecha', value: PAYLOAD, emphasis: 'highlight' }]);
    expect(injected(high)).toBe(false);
    expect(high).toContain('<strong style="color:#0f766e;">&lt;script&gt;');
  });
});

describe('safeUrl', () => {
  it('deja pasar http y https', () => {
    expect(safeUrl('https://ejemplo.com/a')).toBe('https://ejemplo.com/a');
    expect(safeUrl('http://ejemplo.com/a')).toBe('http://ejemplo.com/a');
  });

  it('degrada cualquier otro esquema a "#"', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
    expect(safeUrl('no-es-una-url')).toBe('#');
  });
});

describe('ningún dato de usuario se inyecta en los correos', () => {
  // Cada caso coloca el payload en un campo distinto que proviene de datos
  // que escribe una persona y termina en el HTML del correo.
  const cases: Array<[string, () => string]> = [
    ['cancelada/alumno · motivo',        () => appointmentCancelledStudentTemplate('Ana', 'Dra. X', { ...base, reason: PAYLOAD })],
    ['cancelada/alumno · especialista',  () => appointmentCancelledStudentTemplate('Ana', PAYLOAD, { ...base })],
    ['cancelada/alumno · alumno',        () => appointmentCancelledStudentTemplate(PAYLOAD, 'Dra. X', { ...base })],
    ['cancelada/alumno · modalidad',     () => appointmentCancelledStudentTemplate('Ana', 'Dra. X', { ...base, modality: PAYLOAD })],
    ['cancelada/esp · motivo',           () => appointmentCancelledSpecialistTemplate('Dra. X', 'Ana', { ...base, reason: PAYLOAD })],
    ['cancelada/esp · alumno',           () => appointmentCancelledSpecialistTemplate('Dra. X', PAYLOAD, { ...base })],
    ['confirmada · especialista',        () => appointmentConfirmedTemplate('Ana', { ...base, specialistName: PAYLOAD, department: 'Psicología' } as any)],
    ['confirmada · sede',                () => appointmentConfirmedTemplate('Ana', { ...base, specialistName: 'S', department: 'Psicología', modality: 'Presencial', location: PAYLOAD } as any)],
    ['confirmada · departamento',        () => appointmentConfirmedTemplate('Ana', { ...base, specialistName: 'S', department: PAYLOAD } as any)],
    ['nueva/alumno · motivo',            () => appointmentNewStudentTemplate('Ana', { ...base, specialistName: 'S', department: 'x', reason: PAYLOAD } as any)],
    ['nueva/esp · alumno',               () => appointmentNewSpecialistTemplate('S', { ...base, studentName: PAYLOAD, department: 'x' } as any)],
    ['reagendada/alumno · especialista', () => appointmentRescheduledStudentTemplate('Ana', PAYLOAD, { ...base, previousDate: 'a', previousTime: 'b', newDate: 'c', newTime: 'd' } as any)],
    ['reagendada/esp · alumno',          () => appointmentRescheduledSpecialistTemplate('S', PAYLOAD, { ...base, previousDate: 'a', previousTime: 'b', newDate: 'c', newTime: 'd' } as any)],
  ];

  it.each(cases)('%s', (_name, render) => {
    const html = render();
    expect(injected(html)).toBe(false);
    expect(html).toContain('&lt;script&gt;');
  });
});
