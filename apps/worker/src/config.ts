import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  // Must match the API's queue name. BullMQ rejects ':' in queue names.
  EXECUTION_QUEUE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_.-]+$/, 'EXECUTION_QUEUE_NAME may only contain letters, digits, . _ or -')
    .default('hirefo-execution'),
  EXECUTION_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  EXECUTION_RUNNER: z.enum(['DOCKER', 'LOCAL_SUBPROCESS']).default('DOCKER'),
  /** Tag applied to the runtime images built by scripts/build-runtimes.sh. */
  RUNTIME_IMAGE_TAG: z.string().default('1'),
  DOCKER_BIN: z.string().default('docker'),
});

export type WorkerConfig = Readonly<z.infer<typeof envSchema>> & { readonly isProd: boolean };

let cached: WorkerConfig | null = null;

export function config(): WorkerConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid worker environment:\n${details}\n\nSee .env.example.`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.EXECUTION_RUNNER === 'LOCAL_SUBPROCESS') {
    throw new Error(
      'EXECUTION_RUNNER=LOCAL_SUBPROCESS is a development-only fallback and is refused in production.',
    );
  }
  cached = Object.freeze({ ...parsed.data, isProd: parsed.data.NODE_ENV === 'production' });
  return cached;
}
