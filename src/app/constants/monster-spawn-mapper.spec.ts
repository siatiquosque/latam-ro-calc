import { expect, it } from 'vitest';
import { getMonsterMapCodes } from './monster-spawn-mapper';

it('shows real spawn maps without claiming synthetic groups are map codes', () => {
  expect(getMonsterMapCodes('jor_back2, jor_back3,jor_back2')).toEqual(['jor_back2', 'jor_back3']);
  expect(getMonsterMapCodes('MD_EP19')).toEqual([]);
  expect(getMonsterMapCodes()).toEqual([]);
});
