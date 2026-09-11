import { createApp } from './app';
import { startReminderScheduler, stopReminderScheduler } from './services/appointmentReminders';

const PORT = process.env.PORT || 3000;

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);

  // Va aquí y no en createApp() porque `app.ts` es lo que montan las pruebas:
  // construir la app no debe poner en marcha trabajos de fondo.
  startReminderScheduler();
});

// Apagado ordenado: sin esto, un despliegue corta las peticiones en curso.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} recibido, cerrando…`);
    stopReminderScheduler();
    server.close(() => process.exit(0));
  });
}
