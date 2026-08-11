#!/bin/sh
# CDEB evaluator entrypoint wrapper (PRD §12.1 task_entrypoint shape).
# Type-stripping runs the sealed engine sources directly — no build step
# inside the image that a candidate tree could influence.
exec node --experimental-strip-types /cdeb/engine/entrypoint.ts "$@"
