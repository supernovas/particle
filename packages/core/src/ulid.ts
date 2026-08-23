const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Crockford-base32 ULID: 48-bit timestamp + 80-bit randomness, lexically sortable. */
export function ulid(time: number = Date.now()): string {
  let t = time;
  const ts = new Array<string>(10);
  for (let i = 9; i >= 0; i--) {
    ts[i] = B32[t % 32]!;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(acc >>> bits) & 31];
    }
  }
  return ts.join('') + out;
}
