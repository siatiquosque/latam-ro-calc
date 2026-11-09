import { describe, expect, it } from 'vitest';
import { ITEM_DB } from './worn-bonus';

/**
 * Reformed weapons: 211 weapons from https://hazyforest.com/equipment:item_reform, listed as `preRelease` previews with the English divine-pride text; bonuses were converted from that text.
 *
 * Still left out, for want of an engine stage:
 *   - per-skill SP consumption increases
 *   - enabling or requiring a learned skill level
 *   - other sentences the parser could not read
 *   - auto-cast procs and "when using <skill>" effects
 *   - skills missing from the catalog (mostly Alitea)
 *   - "when dealing normal melee physical damage" conditions
 *   - set partners absent from the item list
 *   - "grade of each" set conditions
 *   - hit physical damage (no engine key)
 *   - timed [additional effects] buff blocks
 *   - per-skill fixed casting time increases
 * Each is kept in the description only; no number was invented for them.
 */

const IDS = [500056, 500074, 500092, 500093, 500094, 500101, 500102, 500103, 500107, 500120, 500134, 500136, 510077, 510102, 510103, 510105, 510106, 510139, 510150, 510151, 510152, 510172, 510185, 510189, 510191, 510192, 510193, 510199, 510205, 510211, 510212, 520031, 520047, 520048, 520050, 520052, 520055, 520060, 530035, 530054, 530057, 530058, 530060, 530072, 530074, 530076, 530087, 540058, 540074, 540075, 540079, 540080, 540081, 540082, 540083, 540086, 540087, 540088, 540090, 540091, 540094, 540096, 540110, 540111, 540114, 540115, 540119, 540122, 540125, 550091, 550092, 550117, 550118, 550119, 550130, 550131, 550132, 550133, 550134, 550135, 550141, 550143, 550144, 550145, 550146, 550148, 550150, 550152, 550155, 550156, 550159, 550176, 550177, 550178, 550187, 550190, 550194, 550195, 550196, 550197, 560038, 560048, 560060, 560061, 560067, 560068, 560072, 560081, 560086, 560088, 570033, 570045, 570062, 570063, 570072, 570073, 570075, 570087, 570090, 570093, 580034, 580046, 580061, 580062, 580072, 580073, 580075, 580087, 580090, 580093, 590049, 590062, 590063, 590079, 590080, 590087, 590103, 590104, 590106, 590107, 590111, 590112, 590116, 590117, 590121, 590122, 590124, 600031, 600054, 600059, 600071, 610042, 610054, 610071, 610072, 610089, 610093, 620020, 620037, 620040, 620043, 620057, 620058, 620059, 630028, 630041, 630045, 630049, 630060, 630066, 640035, 640046, 640049, 640050, 640053, 640054, 640064, 640065, 640067, 650029, 650046, 650047, 650049, 650058, 650061, 650062, 700060, 700076, 700092, 700093, 700094, 700100, 700101, 700108, 700119, 700121, 700125, 700127, 800016, 800042, 810034, 810040, 810042, 810049, 820028, 830033, 830038, 830047, 840028, 840032, 840039];

describe('Reformed weapons', () => {
  it.each(IDS)('%i is present with English text', (id) => {
    expect(ITEM_DB[id]).toBeDefined();
    expect(ITEM_DB[id].description).toMatch(/[A-Za-z]/);
    expect(ITEM_DB[id].description).not.toMatch(/[฀-๿]|^[0-9a-fA-F]{6}/);
  });

  it.each(IDS)('%i is a preview', (id) => {
    expect(ITEM_DB[id].preRelease).toBe(true);
  });
});
