import { Dataset } from '../data/dataset';
import { BuildInput, resolveBuild } from '../engine/build-input';
import { equippedSources } from '../engine/item-context';
import { skillInfo } from '../engine/skill-info';
import { loadSkillTree, skillTreeLoaded } from '../engine/skill-tree';
import { Shortener } from '../engine/share';
import { ValidateConstraints, validateBuild } from '../engine/validate';
import { AnalysisRuntime } from '../runtime';
import { createCalculationOperations, CalculateArgs } from './calculate';
import { createBuildContext } from './context';
import { compact } from './compact';

export interface GetBuildContextArgs {
  build: BuildInput;
  target?: CalculateArgs['target'];
  effects?: string[];
  constraints?: ValidateConstraints;
}

/** Initial consulting facts, composed from existing operations. One calculation, no optimizer. */
export function createBuildContextOperations(dataset: Dataset, config: AnalysisRuntime, shortener?: Shortener) {
  const { normalizeShare } = createBuildContext(config, shortener);
  const calculations = createCalculationOperations(dataset, config, shortener);
  return {
    async getBuildContext({ build, target, effects = [], constraints }: GetBuildContextArgs) {
      const input = await normalizeShare(build);
      await loadSkillTree();
      const validation = validateBuild(input, dataset, constraints, skillTreeLoaded());
      const common = {
        engineVersion: validation.engineVersion,
        dataVersion: validation.dataVersion,
        validation: {
          valid: validation.valid,
          errors: validation.errors.slice(0, 5),
          warnings: validation.warnings.slice(0, 5),
          omitted: { errors: Math.max(0, validation.errors.length - 5), warnings: Math.max(0, validation.warnings.length - 5) },
        },
        sources: validation.sources,
        unknowns: validation.unknowns,
      };
      if (!validation.valid) return { ...common, status: 'invalid' as const };

      const rb = resolveBuild(input, dataset);
      const calculated = await calculations.calculate({ build: input, target, effects });
      const selected = String(rb.model.selectedAtkSkill ?? '');
      const info = rb.char.getAtkSkills(rb.model.skillFormulaVersion).some(skill => skill.name === selected.split('==')[0])
        ? skillInfo(rb.char, selected, rb.model.skillFormulaVersion) : undefined;
      const equipment = equippedSources(rb).map(({ field, id }) => compact({
        field, id, name: rb.items[id]?.name,
        custom: rb.items[id]?.custom || undefined,
        refine: rb.model.customAttachments?.[field]?.refine ?? rb.model[`${field}Refine`],
        grade: rb.model.customAttachments?.[field]?.grade ?? rb.model[`${field}Grade`],
      }));
      return {
        ...common, status: 'ok' as const,
        build: calculated['build'], target: calculated['target'],
        damage: calculated['damage'], stats: calculated['stats'],
        equipment,
        skill: info ? { name: info.name, label: info.label, value: info.value, damageType: info.damageType,
          canCrit: info.canCrit, crit: info.crit,
          scaling: { inputs: info.scaling.inputs, bonusKeys: info.scaling.bonusKeys },
          dependencies: { skills: info.dependencies.skills, coverage: info.dependencies.coverage } } : undefined,
        effects: { selected: effects, available: calculated['availableEffects'] ?? [] },
        share: calculated['share'],
      };
    },
  };
}
