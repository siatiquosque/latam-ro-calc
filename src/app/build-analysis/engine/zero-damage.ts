/**
 * Why a build measured 0 damage, as one sentence the caller can act on. A build with every base stat at 1 (nothing allocated) was
 * the usual cause and the old generic message left the AI trying targets and skills first.
 */
export function zeroDamageReason(model: Record<string, any> | undefined): string {
  const nothingAllocated = model && ['str', 'agi', 'vit', 'int', 'dex', 'luk'].every((stat) => (model[stat] ?? 1) <= 1);
  return nothingAllocated
    ? 'o dano deu 0 porque os atributos base estão todos em 1. Defina build.stats ou rode optimize_stats antes.'
    : 'o dano deu 0 (alvo com defesa ou redução alta, falta arma ou skill em atkSkill). Rode explain_damage para ver o motivo, ou troque o alvo.';
}
