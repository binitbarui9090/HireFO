import type { LanguageId } from '@hirefo/shared';
import { config } from './config.js';

/**
 * How each language is built and run inside the sandbox.
 *
 * The source never reaches the container through a bind mount or `docker cp`: it
 * is passed base64-encoded in HIREFO_SOURCE_B64 and the image's own entrypoint
 * decodes it into a tmpfs. That keeps the container's root filesystem read-only
 * and means the host filesystem is never exposed to the sandbox at all.
 */
export interface RuntimeSpec {
  language: LanguageId;
  image: string;
  /** Entrypoint baked into the image; receives no untrusted arguments. */
  runCommand: string[];
  /** Optional type/compile check run once per job before any test case. */
  checkCommand?: string[];
  localFallback: {
    /** Interpreter on the host for EXECUTION_RUNNER=LOCAL_SUBPROCESS. */
    command: string;
    args: (sourcePath: string) => string[];
    extension: string;
  };
}

const imageName = (suffix: string) => `hirefo-runtime-${suffix}:${config().RUNTIME_IMAGE_TAG}`;

export function runtimeFor(language: LanguageId): RuntimeSpec | null {
  switch (language) {
    case 'javascript':
      return {
        language,
        image: imageName('node'),
        runCommand: ['hirefo-exec', 'javascript'],
        localFallback: {
          command: process.execPath,
          // -I is not a Node flag; isolation on the fallback path comes from the
          // temp cwd, the scrubbed environment and the resource limits in local.ts.
          args: (sourcePath) => [sourcePath],
          extension: 'js',
        },
      };
    case 'typescript':
      return {
        language,
        image: imageName('node'),
        runCommand: ['hirefo-exec', 'typescript'],
        checkCommand: ['hirefo-check', 'typescript'],
        localFallback: {
          command: process.execPath,
          args: (sourcePath) => ['--experimental-strip-types', sourcePath],
          extension: 'ts',
        },
      };
    case 'python':
      return {
        language,
        image: imageName('python'),
        runCommand: ['hirefo-exec', 'python'],
        localFallback: {
          // -I: isolated mode. Ignores PYTHON* env vars and does not put the
          // script's directory or the cwd on sys.path.
          command: 'python3',
          args: (sourcePath) => ['-I', sourcePath],
          extension: 'py',
        },
      };
    default:
      return null;
  }
}
