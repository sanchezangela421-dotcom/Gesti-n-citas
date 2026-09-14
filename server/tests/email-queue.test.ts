import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Cola de salida de correo.
 *
 * El 2026-09-13, durante una prueba con usuarios reales, un recordatorio y el
 * aviso de una cita salieron en el mismo instante y el proveedor rechazó uno con
 * `550 Too many emails per second`. Llegó uno de los dos correos del
 * recordatorio y la operación entera contó como fallida.
 *
 * La causa no era el proveedor: cada función espaciaba sus propios correos con
 * una pausa local, y eso solo ordena los de UNA llamada — no ve lo que están
 * mandando otros flujos a la vez. Lo que se prueba aquí es que ahora TODO el
 * correo sale por una sola cola, a un ritmo, pase lo que pase.
 */

// Todo esto va dentro de `vi.hoisted` porque `vi.mock` se eleva por encima del
// resto del archivo: el módulo de correo se carga —y crea su transporte— antes
// de que se ejecute cualquier `const` de aquí abajo. Las variables de entorno
// también se leen en esa carga; con los valores reales (1100 ms) cada caso
// tardaría segundos.
const { sendMail, sentAt } = vi.hoisted(() => {
  process.env.EMAIL_MIN_INTERVAL_MS = '40';
  process.env.EMAIL_MAX_RETRIES = '2';
  /** Momento de cada envío, para comprobar que no se pisan. */
  const sentAt: number[] = [];
  const sendMail = vi.fn(async () => { sentAt.push(Date.now()); });
  return { sendMail, sentAt };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

import { sendVerificationEmail } from '../src/services/email';

const MIN_GAP = 40;
/** Margen por la imprecisión de los temporizadores del sistema. */
const JITTER = 8;

beforeEach(() => {
  sentAt.length = 0;
  sendMail.mockClear();
  sendMail.mockImplementation(async () => { sentAt.push(Date.now()); });
});

/** Error tal como lo devuelve nodemailer cuando el proveedor limita el ritmo. */
function rateLimitError() {
  return Object.assign(new Error('Data command failed'), {
    responseCode: 550,
    response: '550 5.7.0 Too many emails per second. Please upgrade your plan',
  });
}

describe('un solo ritmo para todos los flujos', () => {
  it('tres correos lanzados a la vez salen separados, no de golpe', async () => {
    // Es el caso que falló: dos flujos distintos enviando en el mismo instante.
    await Promise.all([
      sendVerificationEmail('Ana', 'ana@test.local', 't1'),
      sendVerificationEmail('Beto', 'beto@test.local', 't2'),
      sendVerificationEmail('Caro', 'caro@test.local', 't3'),
    ]);

    expect(sendMail).toHaveBeenCalledTimes(3);
    for (let i = 1; i < sentAt.length; i++) {
      expect(sentAt[i] - sentAt[i - 1]).toBeGreaterThanOrEqual(MIN_GAP - JITTER);
    }
  });

  it('respeta la separación aunque las llamadas lleguen una a una', async () => {
    await sendVerificationEmail('Ana', 'ana@test.local', 't1');
    await sendVerificationEmail('Beto', 'beto@test.local', 't2');

    expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(MIN_GAP - JITTER);
  });
});

describe('cuando el proveedor pide bajar el ritmo', () => {
  it('reintenta y acaba enviando', async () => {
    sendMail
      .mockRejectedValueOnce(rateLimitError())
      .mockImplementationOnce(async () => { sentAt.push(Date.now()); });

    await expect(sendVerificationEmail('Ana', 'ana@test.local', 't1')).resolves.toBeUndefined();
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('se rinde tras agotar los reintentos y avisa a quien esperaba', async () => {
    sendMail.mockRejectedValue(rateLimitError());

    await expect(sendVerificationEmail('Ana', 'ana@test.local', 't1')).rejects.toThrow();
    // El intento original más EMAIL_MAX_RETRIES (2).
    expect(sendMail).toHaveBeenCalledTimes(3);
  });

  it('NO reintenta un rechazo que no mejora esperando', async () => {
    // Mismo código 550, pero por destinatario inexistente: reintentarlo solo
    // gastaría tiempo y cuota.
    sendMail.mockRejectedValue(Object.assign(new Error('Mailbox not found'), {
      responseCode: 550,
      response: '550 5.1.1 Mailbox does not exist',
    }));

    await expect(sendVerificationEmail('Ana', 'nadie@test.local', 't1')).rejects.toThrow();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe('un fallo no debe arrastrar a los demás', () => {
  it('el correo que falla no atasca la cola', async () => {
    sendMail
      .mockRejectedValueOnce(Object.assign(new Error('Mailbox not found'), {
        responseCode: 550, response: '550 5.1.1 Mailbox does not exist',
      }))
      .mockImplementation(async () => { sentAt.push(Date.now()); });

    const primero = sendVerificationEmail('Ana', 'nadie@test.local', 't1');
    const segundo = sendVerificationEmail('Beto', 'beto@test.local', 't2');
    const tercero = sendVerificationEmail('Caro', 'caro@test.local', 't3');

    await expect(primero).rejects.toThrow();
    // Los siguientes salen con normalidad: la cola no se quedó bloqueada por el
    // error anterior, que es lo que dejaría al sistema mudo tras un solo fallo.
    await expect(segundo).resolves.toBeUndefined();
    await expect(tercero).resolves.toBeUndefined();
    expect(sentAt).toHaveLength(2);
  });

  it('el error llega íntegro a quien lo esperaba', async () => {
    sendMail.mockRejectedValue(Object.assign(new Error('Invalid login'), {
      responseCode: 535, response: '535 Authentication failed',
    }));

    // El planificador de recordatorios cuenta los fallos a partir de esto: si el
    // error se tragara aquí, marcaría como enviados correos que nunca salieron.
    await expect(sendVerificationEmail('Ana', 'ana@test.local', 't1'))
      .rejects.toThrow('Invalid login');
  });
});
