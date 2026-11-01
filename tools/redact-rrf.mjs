#!/usr/bin/env node
/**
 * Scrubs names and account ids out of an `.rrf` recording before it goes into the repository.
 *
 * A recording is only obfuscated — every region is XOR-ed with a keystream derived from the
 * header's timestamp — so it is decrypted region by region, the bytes are replaced, and it is
 * encrypted back with the same keystream. Nothing moves: a name is overwritten in place and
 * padded with NULs, so every length and offset in the file stays valid and `decodeReplay`
 * reads the result exactly as it read the original.
 *
 * Replacements:
 *   name:<from>=><to>      text, `to` no longer than `from` (shorter is NUL-padded; empty blanks it)
 *   aid:<from>=><to>       a 32-bit account/character id, as it appears in the packets
 *
 *   node tools/redact-rrf.mjs in.rrf out.rrf "name:Fulano=>Jogador 01" "aid:1002607=>1000001"
 *
 * What to scrub: the recorder's name and aid (`decodeReplay(...).sessionInfo`), every other
 * player the recording saw (`entities` of kind `pc`), and the guild, party and title strings
 * the recorder carries. `scanReplayStrings` lists the readable strings left, to check by eye;
 * re-running a scrub over its own output must report 0 occurrences of everything it removed.
 *
 * NOTE: grepping the raw file for a name proves nothing — the bytes are encrypted.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decryptChunk, deriveKeys, readHeader } from 'rrfparser';

const CONTAINERS = 24;
const DESCRIPTOR_BYTES = 10;
const PACKET_STREAM = 1;

/** Run `visit(offset, length)` over every encrypted region: each packet, and each other container whole. */
function forEachRegion(buffer, visit) {
  const header = readHeader(buffer);
  const view = new DataView(buffer);
  for (let i = 0; i < CONTAINERS; i++) {
    const descriptor = header.containerTableOffset + i * DESCRIPTOR_BYTES;
    const type = view.getUint16(descriptor, true);
    const declared = view.getInt32(descriptor + 2, true);
    const offset = view.getInt32(descriptor + 6, true);
    if (offset <= 0) continue;
    const end = offset + (declared === 0 ? buffer.byteLength - offset : declared);

    if (type === PACKET_STREAM) {
      for (let ptr = offset; ptr + 10 <= end; ) {
        const length = view.getUint16(ptr + 8, true);
        if (ptr + 10 + length > end) break;
        visit(ptr + 10, length);
        ptr += 10 + length;
      }
    } else if (declared > 0) {
      visit(offset, declared);
    }
  }

  return header;
}

const text = (s) => Buffer.from(s, 'latin1');
const id32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(Number(n)); return b; };

/** Parse `kind:from=>to` strings into byte patterns. */
export function parseReplacements(specs) {
  return specs.map((spec) => {
    const colon = spec.indexOf(':');
    const kind = spec.slice(0, colon);
    const [from, to = ''] = spec.slice(colon + 1).split('=>');
    if (kind === 'aid') return { kind, from: id32(from), to: id32(to || 0) };
    if (kind !== 'name') throw new Error(`Replacement must start with name: or aid: — got "${spec}"`);
    if (!from) throw new Error(`Empty text to replace in "${spec}"`);
    if (to.length > from.length) throw new Error(`"${to}" is longer than "${from}"; the file cannot grow`);

    return { kind, from: text(from), to: Buffer.concat([text(to), Buffer.alloc(from.length - to.length)]) };
  });
}

/** Returns the scrubbed copy and how many times each replacement fired. */
export function redactReplay(input, specs) {
  const replacements = parseReplacements(specs);
  const bytes = Buffer.from(input);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const keys = deriveKeys(readHeader(buffer).recordedAt);
  const counts = replacements.map(() => 0);

  forEachRegion(buffer, (offset, length) => {
    const region = new Uint8Array(buffer, offset, length);
    // XOR is its own inverse: the same call decrypts and encrypts.
    const plain = Buffer.from(decryptChunk(region.slice(), length, keys));
    replacements.forEach((r, index) => {
      for (let at = plain.indexOf(r.from); at >= 0; at = plain.indexOf(r.from, at + r.from.length)) {
        r.to.copy(plain, at);
        counts[index]++;
      }
    });
    region.set(decryptChunk(plain, length, keys));
  });

  return { output: Buffer.from(buffer), counts: replacements.map((r, index) => ({ kind: r.kind, text: r.kind === 'name' ? r.from.toString('latin1') : r.from.readUInt32LE(), count: counts[index] })) };
}

/** Every readable ASCII run in the decrypted file, to eyeball what is still identifying. */
export function scanReplayStrings(input, minLength = 5) {
  const bytes = Buffer.from(input);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const keys = deriveKeys(readHeader(buffer).recordedAt);
  const found = new Set();
  const pattern = new RegExp(`[A-Za-z][A-Za-z0-9 _~/.-]{${minLength - 1},}`, 'g');

  forEachRegion(buffer, (offset, length) => {
    const plain = Buffer.from(decryptChunk(new Uint8Array(buffer, offset, length).slice(), length, keys)).toString('latin1');
    for (const match of plain.matchAll(pattern)) found.add(match[0]);
  });

  return [...found];
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}` || process.argv[1]?.endsWith('redact-rrf.mjs')) {
  const [input, output, ...specs] = process.argv.slice(2);
  if (!input || !output || !specs.length) {
    console.error('usage: node tools/redact-rrf.mjs in.rrf out.rrf "name:from=>to" "aid:from=>to" …');
    process.exit(1);
  }
  const { output: scrubbed, counts } = redactReplay(readFileSync(input), specs);
  writeFileSync(output, scrubbed);
  for (const { kind, text: what, count } of counts) console.log(`${kind} ${JSON.stringify(what)} x ${count}`);
}
