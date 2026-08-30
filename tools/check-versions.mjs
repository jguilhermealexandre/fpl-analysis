#!/usr/bin/env node
/* CI wrapper: fails when the asset version is not stamped consistently. */
import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, ['tools/stamp-version.mjs', '--check'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
