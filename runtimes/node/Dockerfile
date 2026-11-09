# HireFO sandbox runtime: JavaScript + TypeScript on Node 20.
#
# Built locally by scripts/build-runtimes.sh and never published. Contains only
# the toolchain needed to type-check, transpile and run one file.
FROM node:20-alpine

# `timeout` (coreutils) is the in-container watchdog; the worker's kill is the
# outer one. tini is not needed: the entrypoint execs the user process directly
# and the container is discarded after a single run.
RUN apk add --no-cache coreutils \
 && npm install -g --no-fund --no-audit typescript@5.7.3 esbuild@0.24.2 \
 && npm cache clean --force

# Node type definitions, placed at a fixed path the sandbox tsconfig points at via
# typeRoots. The sandbox has no node_modules of its own, so tsc cannot discover
# them the usual way.
RUN mkdir -p /opt/hirefo/types /tmp/typesetup \
 && cd /tmp/typesetup \
 && npm install --no-save --no-fund --no-audit @types/node@22.10.5 \
 && mv node_modules/@types/node /opt/hirefo/types/node \
 && cd / && rm -rf /tmp/typesetup && npm cache clean --force

COPY tsconfig.sandbox.json /opt/hirefo/tsconfig.sandbox.json
COPY hirefo-exec /usr/local/bin/hirefo-exec
COPY hirefo-check /usr/local/bin/hirefo-check
RUN chmod 0555 /usr/local/bin/hirefo-exec /usr/local/bin/hirefo-check \
 && chmod 0444 /opt/hirefo/tsconfig.sandbox.json

# The worker also passes --user 65534:65534; this is the in-image default so the
# image is never usable as root even if someone runs it by hand.
USER 65534:65534
WORKDIR /sandbox

# Node's type-stripping/experimental warnings would pollute candidate stderr.
ENV NODE_NO_WARNINGS=1 \
    NODE_ENV=production \
    npm_config_update_notifier=false

ENTRYPOINT []
CMD ["hirefo-exec", "javascript"]
