/** Lazy door to the acquisition operations (~0.8 MB catalog): the Worker bundles it in its own chunk and loads it on first use. */
export const loadAcquisitionOperations = () => import('src/app/build-analysis/operations/acquisition');
