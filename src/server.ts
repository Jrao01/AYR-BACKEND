import { createApp, closeApp } from './app.js';
import { bootstrapDatabase } from './bootstrap.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

try {
  await bootstrapDatabase();
} catch (err) {
  // No se bloquea el arranque: la API queda disponible y /api/health
  // reporta el estado real de la base de datos.
  logger.error({ err }, 'Bootstrap de la base de datos falló; se arranca en modo degradado');
}

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API AYR escuchando');
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Cerrando servidor…');

  const force = setTimeout(() => {
    logger.error('Cierre forzado tras 10 s');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(async () => {
    await closeApp();
    logger.info('Servidor cerrado');
    process.exit(0);
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  // Ante un estado indefinido es mejor reiniciar que seguir atendiendo
  // peticiones: el orquestador levantará un contenedor limpio y el log
  // conservará la traza real del fallo.
  logger.fatal({ err }, 'Excepción no capturada; cerrando proceso');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Promesa rechazada sin manejar');
});
