// @ts-check
// Turns the listening model's token numbers back into text. No DOM, no network.
// The models write text as pieces of UTF-8 bytes (byte-level BPE); each piece is spelled in vocab.json with one printable
// character per byte. Decoding is: pieces -> bytes -> UTF-8 text.

/** The printable character that stands for each byte (the table GPT-2 introduced and Whisper reuses). */
function byteAlphabet() {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  const map = new Map();
  for (const b of keep) map.set(String.fromCharCode(b), b);
  let n = 0;
  for (let b = 0; b < 256; b++) if (!keep.includes(b)) map.set(String.fromCharCode(256 + n++), b);
  return map;
}

/**
 * @param {Record<string, number>} vocab vocab.json (piece -> id)
 * @param {Record<string, number>} added added_tokens.json (special token -> id)
 */
export function createTokens(vocab, added = {}) {
  const alphabet = byteAlphabet();
  /** @type {(Uint8Array|undefined)[]} */
  const bytes = [];
  for (const [piece, id] of Object.entries(vocab)) {
    if (piece in added) continue;
    const b = new Uint8Array(piece.length);
    let ok = true;
    for (let i = 0; i < piece.length; i++) { const v = alphabet.get(piece[i]); if (v === undefined) { ok = false; break; } b[i] = v; }
    if (ok) bytes[id] = b;
  }
  const special = (name) => { const id = added[name] ?? vocab[name]; if (typeof id !== 'number') throw new Error(`token missing: ${name}`); return id; };
  const eot = special('<|endoftext|>');
  const utf8 = new TextDecoder('utf-8');
  return {
    eot,
    special,
    size: Math.max(Object.keys(vocab).length, ...Object.values(added).map((v) => v + 1)),
    /** The bytes one text token stands for (undefined for special tokens). */
    bytesOf: (id) => bytes[id],
    /** @param {number[]} ids */
    decode(ids) {
      const parts = [];
      let total = 0;
      for (const id of ids) { const b = id < eot ? bytes[id] : undefined; if (b) { parts.push(b); total += b.length; } }
      const all = new Uint8Array(total);
      let at = 0;
      for (const p of parts) { all.set(p, at); at += p.length; }
      return utf8.decode(all).replace(/�/g, '').trim();
    },
    /**
     * Ids of the text tokens made only of Hebrew letters and points, spaces, digits and plain punctuation. With this list the
     * model cannot answer in another alphabet, which a small model sometimes does on a short or unclear take.
     * @returns {Uint8Array} 1 for an allowed id, indexed by id (text tokens only)
     */
    hebrewOnly() {
      const ok = new Uint8Array(eot);
      const plain = (c) => c === 0x20 || (c >= 0x30 && c <= 0x39) || [0x21, 0x22, 0x27, 0x2c, 0x2d, 0x2e, 0x3a, 0x3f].includes(c);
      for (let id = 0; id < eot; id++) {
        const b = bytes[id];
        if (!b || !b.length) continue;
        let good = true;
        for (let i = 0; i < b.length && good; i++) {
          const c = b[i];
          if (plain(c)) continue;
          // Hebrew block U+0590..U+05FF is the two bytes D6 90..BF / D7 80..BF; a piece may start or end mid-character
          if (c === 0xd6 || c === 0xd7) { if (i + 1 < b.length) { const d = b[i + 1]; good = c === 0xd6 ? d >= 0x90 && d <= 0xbf : d >= 0x80 && d <= 0xbf; i++; } }
          else if (i === 0 && c >= 0x80 && c <= 0xbf) { /* the second byte of a character begun by the piece before */ }
          else good = false;
        }
        if (good) ok[id] = 1;
      }
      return ok;
    },
  };
}
