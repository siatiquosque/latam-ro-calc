/**
 * Skill tree reference: what each job teaches, the level it caps at, what it requires and from which base/job level. The data is
 * rAthena's kRO tree (data/skill-tree, see tools/build-skill-tree.mjs), NOT confirmed for LATAM, so everything found here is
 * reported as a warning to read against the client, never as an error. It is loaded on demand, like the random-option pools: it is
 * 150 KB that only `validate_build` needs.
 */
export interface TreeSkill { name: string; max?: number; baseLevel?: number; jobLevel?: number; exclude?: boolean; requires?: { name: string; level?: number }[] }
export interface SkillTreeData { jobs: Record<string, { inherit: string[]; skills: Record<string, TreeSkill> }> }

export const SKILL_TREE_SOURCE = {
  origin: 'rathena',
  region: 'kRO',
  path: 'src/data/skill-tree/rathena-skill-tree.json',
  regionalConfirmation: 'unconfirmed',
  enforcement: 'warnings-only',
} as const;

let loaded: SkillTreeData | undefined;
let loading: Promise<void> | undefined;

export const loadSkillTree = (): Promise<void> => loading ??= import('../../../../data/skill-tree/rathena-skill-tree.json')
  .then((module) => { loaded = module.default as unknown as SkillTreeData; }, (error) => { loading = undefined; throw error; });

export const skillTreeLoaded = (): SkillTreeData | undefined => loaded;

const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
/** The calculator's own names for jobs the tree spells differently. */
const JOB_ALIASES: Record<string, string> = { doram: 'Summoner', supernovice: 'Supernovice' };

export interface TreeIssue { code: string; path: string; message: string }

/**
 * Checks the skills a build sets against the tree of its class lineage. `levels` holds every skill level the build sets by name,
 * `exact` the names whose level is what the player learned (a passive selector): a prerequisite whose level is not known exactly
 * (a toggle, or a skill the calculator does not model) is unknown, not missing.
 */
export function checkSkillTree(tree: SkillTreeData, lineage: string[], ownJob: string, levels: Map<string, number>, exact: Set<string>, baseLevel: number, jobLevel: number) {
  const jobKey = (name: string) => JOB_ALIASES[fold(name)] ?? Object.keys(tree.jobs).find((job) => fold(job) === fold(name));
  const jobs = [...new Set(lineage.map(jobKey).filter((job): job is string => !!job))];
  const own = jobKey(ownJob);
  const known = new Map<string, { skill: TreeSkill; job: string }>();
  for (const job of jobs) for (const skill of Object.values(tree.jobs[job].skills)) if (!skill.exclude) known.set(fold(skill.name), { skill, job });

  const issues: TreeIssue[] = [];
  let ownPoints = 0;
  for (const [name, level] of levels) {
    if (!level) continue;
    const entry = known.get(name);
    if (!entry) continue;
    const { skill, job } = entry;
    const label = skill.name;
    if (skill.max !== undefined && level > skill.max) issues.push({ code: 'SKILL_ABOVE_TREE_MAX', path: `skills.${label}`, message: `${label} nível ${level}: a árvore do kRO limita em ${skill.max} (referência).` });
    for (const need of skill.requires ?? []) {
      const key = fold(need.name);
      if (!exact.has(key) || need.level === undefined) continue;
      if ((levels.get(key) ?? 0) < need.level) issues.push({ code: 'SKILL_PREREQUISITE_NOT_MET', path: `skills.${label}`, message: `${label} exige ${need.name} nível ${need.level} (árvore do kRO); a build tem ${levels.get(key) ?? 0}.` });
    }
    if (skill.baseLevel && skill.baseLevel > baseLevel) issues.push({ code: 'SKILL_LEVEL_REQUIREMENT', path: `skills.${label}`, message: `${label} exige nível de personagem ${skill.baseLevel} (árvore do kRO).` });
    if (job === own) {
      if (skill.jobLevel && skill.jobLevel > jobLevel) issues.push({ code: 'SKILL_LEVEL_REQUIREMENT', path: `skills.${label}`, message: `${label} exige nível de classe ${skill.jobLevel} (árvore do kRO).` });
      ownPoints += level;
    }
  }
  // One point per level of class: the points of the class's own skills the build sets cannot pass it (a lower bound, the build may
  // hold skills the calculator does not model).
  const available = Math.max(0, jobLevel - 1);
  if (ownPoints > available) issues.push({ code: 'SKILL_POINTS_OVER_BUDGET', path: 'skills', message: `Habilidades da classe somam ${ownPoints} pontos e o nível de classe ${jobLevel} dá ${available} (referência kRO: 1 ponto por nível).` });

  return { issues, ownPoints, available };
}
