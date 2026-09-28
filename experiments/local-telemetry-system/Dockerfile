FROM node:24.18.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git python3 python3-yaml ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g --ignore-scripts --no-audit --no-fund @openai/codex@0.157.1
WORKDIR /workspace
# Source, Renma and helper scripts are mounted read-only by the experiment runner.
# Only the goal's bounded turn ledger is writable on the host.
