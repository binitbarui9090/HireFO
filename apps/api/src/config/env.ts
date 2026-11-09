import { z } from 'zod';

/**
 * All configuration is read once, validated, and frozen. The process refuses to
 * boot with an invalid config rather than failing later at request time.
 */
const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(def)
    .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    /** Comma-separated list of allowed browser origins. */
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    /** Public base URL of the web app, used to build invitation links. */
    WEB_PUBLIC_URL: z.string().default('http://localhost:5173'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: bool(false),

    /** DOCKER runs each submission in a throwaway container. LOCAL_SUBPROCESS is the documented dev fallback. */
    EXECUTION_RUNNER: z.enum(['DOCKER', 'LOCAL_SUBPROCESS']).default('DOCKER'),
    // BullMQ rejects ':' in queue names (it builds its Redis keys around it).
    EXECUTION_QUEUE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_.-]+$/, 'EXECUTION_QUEUE_NAME may only contain letters, digits, . _ or -')
      .default('hirefo-execution'),
    EXECUTION_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),

    AI_PROVIDER: z.enum(['anthropic', 'openai', 'disabled']).default('disabled'),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default('claude-opus-5'),
    AI_BASE_URL: z.string().optional(),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(16000).default(2000),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(60000),
    /** USD per million tokens, used for cost tracking. */
    AI_PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).default(0),
    AI_PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).default(0),
    /** Daily spend ceiling per organization, USD. 0 disables the check. */
    AI_DAILY_BUDGET_USD: z.coerce.number().min(0).default(5),

    TRUST_PROXY: bool(false),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.AI_PROVIDER !== 'disabled' && !cfg.AI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_API_KEY'],
        message: `AI_API_KEY is required when AI_PROVIDER is "${cfg.AI_PROVIDER}"`,
      });
    }
    if (cfg.NODE_ENV === 'production') {
      if (cfg.EXECUTION_RUNNER === 'LOCAL_SUBPROCESS') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EXECUTION_RUNNER'],
          message:
            'LOCAL_SUBPROCESS is a development-only fallback and must not be used in production. Set EXECUTION_RUNNER=DOCKER.',
        });
      }
      if (!cfg.COOKIE_SECURE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECURE'],
          message: 'COOKIE_SECURE must be true in production.',
        });
      }
    }
  });

export type AppConfig = Readonly<z.infer<typeof envSchema>> & {
  readonly webOrigins: string[];
  readonly isProd: boolean;
  readonly isTest: boolean;
  readonly aiEnabled: boolean;
};

function build(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}\n\nSee .env.example.`);
  }
  const c = parsed.data;
  return Object.freeze({
    ...c,
    webOrigins: c.WEB_ORIGIN.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    isProd: c.NODE_ENV === 'production',
    isTest: c.NODE_ENV === 'test',
    aiEnabled: c.AI_PROVIDER !== 'disabled',
  });
}

let cached: AppConfig | null = null;

export function config(): AppConfig {
  cached ??= build();
  return cached;
}

/** Test helper: forget the cached config so a new env can be applied. */
export function resetConfigCache(): void {
  cached = null;
}
