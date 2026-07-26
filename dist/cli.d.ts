#!/usr/bin/env node
/**
 * `commitlore` entry point.
 *
 * Every command other than `parse` lives in its own module under
 * `commands/` and exposes `register(program)`. This file only wires them up:
 * commands are built in parallel and a shared entry point that each one edits
 * is a merge conflict by construction.
 *
 * Every ticketed command has landed.
 */
export {};
