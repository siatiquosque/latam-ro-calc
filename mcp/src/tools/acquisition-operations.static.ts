/**
 * Same contract as `acquisition-operations.ts` for the VPS bundle, which is one file without chunks. There a dynamic `import()` only makes esbuild
 * wrap the module graph in lazy initialisers, and that breaks the order zod is initialised in (`Class2 is not a constructor` at boot).
 */
import * as operations from 'src/app/build-analysis/operations/acquisition';
export const loadAcquisitionOperations = () => Promise.resolve(operations);
