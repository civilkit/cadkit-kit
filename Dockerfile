# syntax=docker/dockerfile:1.7
# Multi-stage minimal headless CadKit CLI image (Node 22 slim, non-root).
#
# Build from the parent workspace containing both `kit/` and `rebuild/` (or `kernel/`):
#   docker build -f kit/Dockerfile -t cadkit-cli:latest .
#
# Or build from a pre-bundled `dist-cli/` inside `kit/`:
#   npm run build:cli && docker build -f Dockerfile --target runtime-prebuilt -t cadkit-cli:latest .

# ---- Stage 1: bundle CLI + worker-host + WASM --------------------------------
FROM node:22-slim AS builder

ARG KIT_DIR=kit
ARG KERNEL_DIR=rebuild
ARG WASM_PATH=

WORKDIR /src

COPY ${KIT_DIR}/package.json ${KIT_DIR}/package-lock.json* /src/kit/
RUN cd /src/kit && npm ci --ignore-scripts

COPY ${KIT_DIR}/ /src/kit/
COPY ${KERNEL_DIR}/packages/ /src/rebuild/packages/

RUN cd /src/kit && \
    if [ -n "$WASM_PATH" ]; then \
      node tools/build_cli_npm.mjs --kernel-repo /src/rebuild --wasm "$WASM_PATH" --out dist-cli; \
    else \
      node tools/build_cli_npm.mjs --kernel-repo /src/rebuild --out dist-cli; \
    fi

# ---- Stage 2: minimal non-root runtime ---------------------------------------
FROM node:22-slim AS runtime

ENV NODE_ENV=production \
    CK_WASM=/opt/cadkit/ck_wasm.wasm

RUN groupadd --system --gid 10001 cadkit \
 && useradd --system --uid 10001 --gid 10001 --home-dir /work --shell /usr/sbin/nologin cadkit \
 && mkdir -p /opt/cadkit /work \
 && chown cadkit:cadkit /work

COPY --from=builder /src/kit/dist-cli/cadkit.mjs /opt/cadkit/cadkit.mjs
COPY --from=builder /src/kit/dist-cli/worker-host.js /opt/cadkit/worker-host.js
COPY --from=builder /src/kit/dist-cli/ck_wasm.wasm /opt/cadkit/ck_wasm.wasm
COPY --from=builder /src/kit/dist-cli/package.json /opt/cadkit/package.json

RUN chmod 0755 /opt/cadkit/cadkit.mjs \
 && ln -s /opt/cadkit/cadkit.mjs /usr/local/bin/cadkit

USER cadkit
WORKDIR /work

ENTRYPOINT ["cadkit"]
CMD ["--help"]
