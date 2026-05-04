export interface WorkerConfig {
  baseUrl: string;
}

const DEV_WORKER_URL = 'https://tryon-dev.patidar05sheetal.workers.dev';
const PROD_WORKER_URL = 'https://tryon-dev.patidar05sheetal.workers.dev'; // TODO: update to prod worker before final CWS submit

export function getWorkerConfig(): WorkerConfig {
  const isProd = import.meta.env.MODE === 'production';
  return { baseUrl: isProd ? PROD_WORKER_URL : DEV_WORKER_URL };
}
