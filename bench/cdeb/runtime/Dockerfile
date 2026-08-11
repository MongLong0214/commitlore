# CDEB-03 pinned agent runtime image (PRD §7.1).
#
# This file defines the image the study measures in; the pin manifest
# (runtime-pin.json) records the digest the freeze ceremony observes after
# building it. The digest — not this file — is what the capability gate
# matches at run time, so editing this file after the freeze changes nothing
# until a new freeze records a new digest.
#
# Image contents, per §7.1:
#   - agent CLI, pinned version installed at build time
#   - exact Node runtime (base image tag pinned here, digest pinned by the freeze)
#   - Git
#   - pinned CommitLore build (this repository's committed dist/, ADR-0011)
#   - the provider-only egress proxy script (run from this same image, so its
#     code is pinned by the same digest)
#   - NO user settings, NO MCP servers, NO session state: the layers carry
#     none, the container mounts none, and HOME starts empty every run.
#
# The offline dependency cache slot (§7.1) is filled by the freeze ceremony
# for repositories whose tasks install dependencies; the base image does not
# guess at it.

FROM node:22.23.2-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pinned agent CLI. The version is build-argument data; the freeze ceremony
# records the resulting executable hash in runtime-pin.json, and the gate
# verifies that hash inside the container before any measured run.
ARG AGENT_CLI_VERSION
RUN test -n "$AGENT_CLI_VERSION" \
    && npm install --global "@anthropic-ai/claude-code@$AGENT_CLI_VERSION" \
    && npm cache clean --force

# Pinned CommitLore build: the committed dist tree of the harness repository,
# copied as-is so the ON arm's shipping command runs the shipped bytes.
COPY dist/ /opt/commitlore/dist/

# Provider-only egress proxy (PRD §7.4), run as:
#   node /opt/cdeb/egress-proxy.mjs
COPY bench/cdeb/runtime/egress-proxy.mjs /opt/cdeb/egress-proxy.mjs

# CDEB-04's observer is TypeScript only because the pinned Node runtime strips
# its erasable types.  It is copied with the parser it imports; the settings
# command invokes this wrapper, which in turn invokes the shipping dist CLI.
COPY bench/cdeb/runtime/exposure.ts /opt/cdeb/exposure.ts
COPY bench/cdeb/runtime/shipping-proxy.ts /opt/cdeb/shipping-proxy.ts

# Isolated HOME (§7.2): created empty, owned by nobody's history. The run
# spec sets HOME here and mounts nothing over it; the container is discarded
# after each logical run, so nothing in it can reach the next one.
RUN mkdir -p /home/agent

WORKDIR /repo
ENV HOME=/home/agent
# `node:sqlite` emits a PID-bearing runtime warning.  The pinned runtime
# suppresses Node warnings for both a direct shipping invocation and the child
# the proxy starts; otherwise two equivalent hook processes cannot have equal
# stderr bytes solely because their process IDs differ.
ENV NODE_NO_WARNINGS=1
