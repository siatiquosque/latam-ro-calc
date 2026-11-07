import data from '../../../../data/acquisition/latam.v1.json';
import drops from '../../../../data/acquisition/drops.v1.json';
import { knowledgeSchema } from './contracts';
import { dropTableSchema } from './drops';

/** Bundled reference; no network, filesystem, UI or transport dependency. Drops ride as columns and become routes per query. */
const dropTable = dropTableSchema.parse(drops);
export const acquisitionKnowledge = knowledgeSchema.parse({ ...data, sources: [...data.sources, dropTable.source], drops: dropTable });
