// Se ejecuta antes de cada archivo de test (antes de que importen la app).
process.env.NODE_ENV = 'test';
process.env.AUTH_RATE_MAX = '50';
process.env.MAX_UPLOAD_MB = '1';
process.env.LOG_LEVEL = 'silent';
// Los tests nunca deben llamar a Wisphub: el envío queda en segundo plano y
// solo se marca el lead como pendiente con error.
process.env.WISPHUB_API_KEY = '';
