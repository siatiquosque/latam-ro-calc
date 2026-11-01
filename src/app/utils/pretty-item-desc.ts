import { SKILL_DESC_BY_ID } from '../skills';
import { PREVIEW_275_DESCRIPTIONS } from '../skills/preview-275-descriptions';
import { PREVIEW_285_DESCRIPTIONS } from '../skills/preview-285-reference';

export const prettyItemDesc = (desc: string) =>
  desc?.replaceAll('\n', '<br>').replace(/\^(.{6})/g, '<font color="#$1">');

const skillDescCache = new Map<number, string>();

/** Hover-popover HTML for a skill, by the in-game skill id the UI already carries as its
 *  icon. Empty when the catalog has no description for it, so a caller can bind the result
 *  straight to `appTooltip` and get no box at all rather than an empty one.
 *
 *  Shared by every place that shows a skill: the active-skill pickers, the rotation's
 *  "add skill" dropdown and the rotation step details panel. They all used to be on their
 *  own — which is why several of them silently showed nothing. */
export const skillDescHtml = (skillId?: number): string => {
  if (!skillId) return '';

  const cached = skillDescCache.get(skillId);
  if (cached !== undefined) return cached;

  const html = prettyItemDesc(PREVIEW_285_DESCRIPTIONS[skillId] ?? PREVIEW_275_DESCRIPTIONS[skillId] ?? SKILL_DESC_BY_ID[skillId]) || '';
  // A missing description can still be in flight; do not cache that empty result.
  if (html) skillDescCache.set(skillId, html);

  return html;
};

/** Full hover-popover HTML for an item: name, numeric ID and client description.
 *  Shared by every item dropdown (equipment, shadow, costume/visual, pet).
 *  `description` comes in separately (ItemDescriptionStore) because it loads
 *  after the item map; before it lands this renders the name alone.
 *
 *  Long descriptions (Chapéu de Kiwawa 401147 runs to 56 lines) get no special handling
 *  here any more: excess height is the popover's own job, since it scrolls vertically
 *  (see `.item_desc_tooltip .ui-tooltip-text` in styles.css). They used to flow into a
 *  second column, which broke reading down the middle. */
export const itemDescPopoverHtml = (item?: { name?: string; id?: number }, description?: string): string => {
  const desc = prettyItemDesc(description) || '';
  const safeName = item?.name?.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const id = Number.isSafeInteger(item?.id) ? `<div class="item_desc_id">ID: ${item.id}</div>` : '';
  const title = safeName || id ? `<div class="item_desc_title">${safeName ? `<b>${safeName}</b>` : ''}${id}</div><br>` : '';
  if (!title && !desc) return '';

  return `${title}${desc}`;
};
