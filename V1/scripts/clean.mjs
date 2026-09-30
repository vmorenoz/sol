import { rmSync } from 'node:fs';

// tsc does not remove outputs for deleted sources. Only this package's generated
// directory is removed; source, user workspaces and runtime data are untouched.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
