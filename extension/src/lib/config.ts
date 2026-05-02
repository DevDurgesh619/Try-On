export interface WorkerConfig {
  baseUrl: string;
}

const DEV_WORKER_URL = 'http://localhost:8787';
const PROD_WORKER_URL = 'https://tryon.workers.dev';

export function getWorkerConfig(): WorkerConfig {
  const isProd = import.meta.env.MODE === 'production';
  return { baseUrl: isProd ? PROD_WORKER_URL : DEV_WORKER_URL };
}
