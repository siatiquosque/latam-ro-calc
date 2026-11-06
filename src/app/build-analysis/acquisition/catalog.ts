import data from '../../../../data/acquisition/latam.v1.json';
import { knowledgeSchema } from './contracts';

/** Small bundled reference; no network, filesystem, UI or transport dependency. */
export const acquisitionKnowledge = knowledgeSchema.parse(data);
