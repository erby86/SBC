// The page's CSP has no 'unsafe-eval' (M17). Zod 4 otherwise probes `new Function` for its
// JIT, and the browser reports a CSP violation on every load. Imported first in main.tsx.
import { z } from 'zod';

z.config({ jitless: true });
