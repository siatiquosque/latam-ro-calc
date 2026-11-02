import { EQUIPMENT_SLOTS } from 'src/app/app-config/equipment-slots';
import { JobBuffs } from 'src/app/constants/job-buffs';
import { refineLimitFor } from 'src/app/core/equipment-rules';
import { SKILL_ID_BY_NAME } from 'src/app/skills';
import { canGradeItem } from 'src/app/utils/can-grade';
import { ResolvedBuild } from './build-input';
import { SynergyRule } from './synergies';
import { BuildPatch } from './variants';
import { ensureCustomAttachment } from 'src/app/core/custom-attachments';

export interface ConditionChanges {
  allowChanges?: ('refine' | 'grade' | 'stats' | 'skills')[];
  maxRefine?: number;
  maxGrade?: 'none' | 'D' | 'C' | 'B' | 'A';
}

/** Minimum proposals from the existing visual-rule parser. The motor, not these hints, decides activation. */
export function conditionPatch(rb: ResolvedBuild, source: string, rule: SynergyRule, constraints: ConditionChanges): BuildPatch {
  let patch: BuildPatch = {};
  const permission = new Set(constraints.allowChanges ?? []);
  const parent = EQUIPMENT_SLOTS.find(slot => slot.key === source || slot.cardFields.includes(source as never) || slot.enchantFields.includes(source as never));
  for (const condition of rule.conditions) {
    if ((condition.kind === 'refine' || condition.kind === 'refineStep') && permission.has('refine') && parent) {
      const key = `${parent.key}Refine`;
      const minimum = Number(condition.value);
      const custom = rb.items[rb.model[parent.key]]?.custom ? ensureCustomAttachment(rb.model, parent.key, rb.items[rb.model[parent.key]]) : undefined;
      const current = Number(patch.customAttachments?.[parent.key]?.refine ?? custom?.refine ?? patch.gear?.[key] ?? rb.model[key] ?? 0);
      if (minimum > current && minimum <= Math.min(constraints.maxRefine ?? 20, refineLimitFor(parent.key, rb.items[rb.model[parent.key]]))) {
        if (custom) patch.customAttachments = { ...patch.customAttachments, [parent.key]: { ...custom, grade: (custom.grade ?? '') as '' | 'D' | 'C' | 'B' | 'A', refine: minimum } };
        else patch.gear = { ...patch.gear, [key]: minimum };
      }
    }
    if (condition.kind === 'grade' && permission.has('grade')) {
      const slot = source.replace(/Enchant\d/, '');
      const key = `${slot}Grade`;
      const grades = ['', 'D', 'C', 'B', 'A'];
      const wanted = grades.indexOf(String(condition.value));
      const maximum = constraints.maxGrade === undefined ? 4 : constraints.maxGrade === 'none' ? 0 : grades.indexOf(constraints.maxGrade);
      const custom = rb.items[rb.model[slot]]?.custom ? ensureCustomAttachment(rb.model, slot, rb.items[rb.model[slot]]) : undefined;
      if (wanted > grades.indexOf(String(custom?.grade ?? rb.model[key] ?? '')) && wanted <= maximum && canGradeItem(rb.items[rb.model[slot]])) {
        if (custom) patch.customAttachments = { ...patch.customAttachments, [slot]: { ...custom, ...patch.customAttachments?.[slot], grade: grades[wanted] as 'D' | 'C' | 'B' | 'A' } };
        else patch.gear = { ...patch.gear, [key]: condition.value };
      }
    }
    if (['stat', 'statMin'].includes(condition.kind) && permission.has('stats')) {
      const name = String(condition.value);
      if (['str', 'agi', 'vit', 'int', 'dex', 'luk'].includes(name)) {
        const wanted = Math.max(Number(patch.stats?.[name] ?? rb.model[name] ?? 0), condition.extra ?? 0);
        patch.stats = { ...patch.stats, [name]: wanted };
      }
    }
    if (['skill', 'activeSkill'].includes(condition.kind) && permission.has('skills')) {
      const groups = condition.kind === 'skill' ? [{ kind: 'passive' as const, defs: rb.char.passiveSkills }]
        : [{ kind: 'active' as const, defs: rb.char.activeSkills }, { kind: 'buffs' as const, defs: JobBuffs }];
      for (const group of groups) {
        const skill = group.defs.find(entry => SKILL_ID_BY_NAME[entry.name as keyof typeof SKILL_ID_BY_NAME] === Number(condition.value));
        if (!skill) continue;
        const level = skill.dropdown.map(entry => Number(entry.value)).filter(value => Number.isFinite(value) && value >= (condition.extra ?? 1)).sort((a, b) => a - b)[0];
        if (level !== undefined) patch.skills = { ...patch.skills, [group.kind]: { ...patch.skills?.[group.kind], [skill.name]: level } };
        break;
      }
    }
  }
  return patch;
}
