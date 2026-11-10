import { readFileSync } from 'node:fs';
import { statePath } from './env';
import type { Fixture } from './global-setup';

/** What the global setup created for this run (call inside a test, not at import time). */
export const fixture = (): Fixture => JSON.parse(readFileSync(statePath('fixture.json'), 'utf8'));
export const treeUrl = () => `/trees/${fixture().treeId}`;
