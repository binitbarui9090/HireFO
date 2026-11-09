# HireFO sandbox runtime: Python 3.12.
FROM python:3.12-alpine

RUN apk add --no-cache coreutils

COPY hirefo-exec /usr/local/bin/hirefo-exec
RUN chmod 0555 /usr/local/bin/hirefo-exec

USER 65534:65534
WORKDIR /sandbox

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ENTRYPOINT []
CMD ["hirefo-exec", "python"]
