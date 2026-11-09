import { config } from '../config.js';
import { createDockerRunner } from './docker.js';
import { createLocalRunner } from './local.js';
import type { SandboxRunner } from './types.js';

let cached: SandboxRunner | null = null;

export function sandboxRunner(): SandboxRunner {
  cached ??= config().EXECUTION_RUNNER === 'DOCKER' ? createDockerRunner() : createLocalRunner();
  return cached;
}

export * from './types.js';
