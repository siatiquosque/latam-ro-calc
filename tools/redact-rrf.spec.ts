import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeReplay } from 'rrfparser';
// @ts-expect-error — a plain .mjs script, no declarations.
import { parseReplacements, redactReplay, scanReplayStrings } from './redact-rrf.mjs';

const FIXTURE = 'src/app/replay/__tests__/fixtures/inq-demonio-flagelo.rrf';
const bytes = readFileSync(FIXTURE);
const decode = (file: Buffer) => decodeReplay(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)) as any;

describe('redact-rrf', () => {
  it('renames the recorder and swaps its aid without moving anything else', () => {
    const before = decode(bytes);
    const { output, counts } = redactReplay(bytes, [`name:${before.sessionInfo.player}=>Jogador 99`, `aid:${before.sessionInfo.aid}=>1000099`]);
    const after = decode(output);

    expect(output.length).toBe(bytes.length);
    expect(after.sessionInfo.player).toBe('Jogador 99');
    expect(after.sessionInfo.aid).toBe(1000099);
    expect(counts.every((c: { count: number }) => c.count > 0)).toBe(true);

    // The damage the recorder dealt is the same, packet for packet, under its new aid.
    const dealt = (replay: any) => replay.damage.filter((d: any) => d.source === replay.sessionInfo.aid).map((d: any) => [d.time, d.skillId, d.damage]);
    expect(dealt(after)).toEqual(dealt(before));
    expect(dealt(after).length).toBeGreaterThan(0);
  });

  it('leaves nothing of a scrubbed name behind, and a second pass finds nothing to do', () => {
    const name = decode(bytes).sessionInfo.player as string;
    const { output } = redactReplay(bytes, [`name:${name}=>`]);

    expect(scanReplayStrings(output).some((s: string) => s.includes(name))).toBe(false);
    expect(redactReplay(output, [`name:${name}=>`]).counts[0].count).toBe(0);
  });

  it('refuses a replacement that would grow the file, or one it cannot read', () => {
    expect(() => parseReplacements(['name:abc=>abcd'])).toThrow(/longer/);
    expect(() => parseReplacements(['nick:abc=>x'])).toThrow(/name: or aid:/);
  });
});
