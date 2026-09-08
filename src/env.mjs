/**
 * Loads .env into process.env using Node's built-in loader, so the project
 * keeps a zero-dependency footprint. Importing this module is the whole API.
 *
 * A missing .env is not an error here. The scripts that need a key check for
 * one themselves and say so plainly, which is a better message than a parse
 * failure from a file that was never meant to exist yet.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ENV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');

if (existsSync(ENV_PATH)) {
  if (typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(ENV_PATH);
  } else {
    throw new Error(
      `Node ${process.versions.node} has no process.loadEnvFile. This project ` +
        'needs Node 20.12 or newer, which is what keeps it dependency free.'
    );
  }
}

export const ENV_FILE_PRESENT = existsSync(ENV_PATH);
