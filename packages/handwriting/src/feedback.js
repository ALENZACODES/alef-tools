// @ts-check
// What to say to the learner after the letter checker has looked at a drawing. No DOM.
// Rules for this copy: plain English, kind, one tip at a time. The check is a hint, never a grade: when the checker is
// not sure, it says nothing rather than risk correcting a letter that was fine.

import { CLASSES, NOT_A_LETTER, indexOf } from './classify.js';

export const NAMES = Object.freeze({
  alef: 'Aleph', bet: 'Bet', gimel: 'Gimel', dalet: 'Dalet', he: 'He', vav: 'Vav', zayin: 'Zayin', chet: 'Chet', tet: 'Tet', yod: 'Yod',
  kaf: 'Kaf', lamed: 'Lamed', mem: 'Mem', nun: 'Nun', samekh: 'Samekh', ayin: 'Ayin', pe: 'Pe', tsadi: 'Tsadi', qof: 'Qof', resh: 'Resh',
  shin: 'Shin', tav: 'Tav', 'kaf-final': 'Final Kaf', 'mem-final': 'Final Mem', 'nun-final': 'Final Nun', 'pe-final': 'Final Pe', 'tsadi-final': 'Final Tsadi',
});

// Letters that are told apart mostly by how long they are, in print and in cursive. The picture the checker reads has no
// size in it, so for these the drawn height decides (see resolveBySize).
export const SIZE_FAMILY = Object.freeze(['yod', 'vav', 'nun-final']);

// The pairs the checker reports on separately (see README: acceptance numbers).
export const CONFUSABLE_GROUPS = Object.freeze([['bet', 'kaf'], ['dalet', 'resh'], ['he', 'chet'], ['vav', 'zayin', 'nun-final'], ['samekh', 'mem-final']]);

// One tip per (letter wanted | letter it looks like). Size tips hold for print and cursive; the others describe the
// print (block) letter and are used only when the learner is tracing print.
const SIZE_TIPS = {
  'vav|yod': 'Vav comes all the way down to the line. Keep going a little further.',
  'yod|vav': 'Yod is small and stays near the top. Stop about halfway down.',
  'vav|nun-final': 'Vav stops at the line. Final Nun is the long one that drops below it.',
  'nun-final|vav': 'Final Nun is longer than Vav. Let it drop below the line.',
  'yod|nun-final': 'Yod is the smallest letter. Keep it short and near the top.',
  'nun-final|yod': 'Final Nun is a long line that drops below the others. Make it much longer.',
};
const PRINT_TIPS = {
  'bet|kaf': 'Bet has a flat base that sticks out a little on the right, like a small heel. Give it that corner.',
  'kaf|bet': 'Kaf is one smooth curve, with no corner at the bottom right. Round it off.',
  'dalet|resh': 'In Dalet the top line reaches a little past the leg on the right. Let that small corner stick out.',
  'resh|dalet': 'Resh bends in one smooth curve. Nothing sticks out at the top right.',
  'he|chet': 'He has a small gap at the top left. Stop the left leg before it touches the roof.',
  'chet|he': 'In Chet the left leg touches the roof. Close the gap at the top left.',
  'he|tav': 'He has a gap at the top left and no foot. Leave the left leg short and plain.',
  'tav|he': 'In Tav the left leg touches the roof and ends in a small foot. Join it at the top and add the foot.',
  'chet|tav': 'Chet stands on two plain legs. Leave off the small foot at the bottom left.',
  'tav|chet': 'Tav has a small foot at the bottom of its left leg. Add that foot.',
  'vav|zayin': 'Vav is a plain line with a small hook to the left at the top. Keep the top from sticking out on the right.',
  'zayin|vav': 'The top of Zayin sits across the line and sticks out on both sides. Vav only leans left.',
  'zayin|nun-final': 'Zayin stops at the line and has a top that sticks out on both sides. Keep it short.',
  'nun-final|zayin': 'Final Nun is a long plain line that drops below the others. Make it longer.',
  'samekh|mem-final': 'Samekh is round at the bottom. Final Mem is the square one.',
  'mem-final|samekh': 'Final Mem is a closed square with corners. Samekh is the round one.',
  'gimel|nun': 'Gimel stands on two legs. Add the small leg that kicks out at the bottom left.',
  'nun|gimel': 'Nun sits on a flat base along the bottom, with no separate leg.',
  'kaf|nun': 'Kaf is wide, about as wide as it is tall. Nun is the narrow one.',
  'nun|kaf': 'Nun is narrow. Bring the top and the base in so it is about half as wide.',
  'kaf|pe': 'Kaf is empty inside. Leave out the small curl under the roof.',
  'pe|kaf': 'Pe has a small curl hanging from the roof on the inside. Add it.',
  'mem|tet': 'Mem is open at the bottom left. Tet is open at the top.',
  'tet|mem': 'Tet is open at the top, and its left side curls in. Close the bottom.',
  'dalet|kaf-final': 'Dalet stops at the line. Keep the leg short.',
  'kaf-final|dalet': 'Final Kaf has a long leg that drops below the line. Make the leg longer.',
  'resh|kaf-final': 'Resh stops at the line. Keep the leg short.',
  'kaf-final|resh': 'Final Kaf has a long leg that drops below the line. Make the leg longer.',
};

const label = (id) => { const c = CLASSES[indexOf(id)]; return c && c.char ? `${NAMES[id]} (${c.char})` : NAMES[id] || id; };

/** The tip for "wanted `target`, looks like `looks`", or null when there is no specific one. */
export function tipFor(target, looks, script = 'print') {
  const key = `${target}|${looks}`;
  return SIZE_TIPS[key] || (script === 'print' ? PRINT_TIPS[key] : null) || null;
}

/**
 * Among the long-and-thin letters, let the drawn height decide.
 * @param {string} id what the checker picked
 * @param {number} drawnHeight height of what the learner drew
 * @param {Record<string, number>} heights height of each family letter's own model, same units and script
 * @returns {string} the family letter whose model height is closest (by ratio), or `id` unchanged if it is not in the family
 */
export function resolveBySize(id, drawnHeight, heights) {
  if (!SIZE_FAMILY.includes(id) || !(drawnHeight > 0) || !heights) return id;
  let best = id; let bestGap = Infinity;
  for (const f of SIZE_FAMILY) { const h = heights[f]; if (!(h > 0)) continue; const gap = Math.abs(Math.log(drawnHeight / h)); if (gap < bestGap) { bestGap = gap; best = f; } }
  return best;
}

export const THRESHOLDS = Object.freeze({ sure: 0.6, targetOk: 0.3, notALetter: 0.7 });

/**
 * Turn the checker's scores into at most one sentence for the learner.
 * @param {{probs: ArrayLike<number>, ranking: {id:string, char:string, p:number}[]}} result from classify()
 * @param {{targetId: string, script?: 'print'|'cursive', drawnHeight?: number, heights?: Record<string, number>}} o
 * @returns {{verdict: 'match'|'close'|'looks-like'|'not-a-letter'|'unsure', looksLike: string|null, confidence: number, text: string|null, tip: string|null}}
 */
export function checkLetter(result, { targetId, script = 'print', drawnHeight, heights } = /** @type {any} */ ({})) {
  const ti = indexOf(targetId);
  if (ti < 0 || targetId === NOT_A_LETTER) throw new RangeError(`checkLetter: unknown letter "${targetId}"`);
  const top = result.ranking[0];
  const pTarget = result.probs[ti];
  const unsure = { verdict: /** @type {'unsure'} */ ('unsure'), looksLike: null, confidence: top.p, text: null, tip: null };
  if (top.id === NOT_A_LETTER) {
    if (top.p < THRESHOLDS.notALetter) return unsure;
    return { verdict: 'not-a-letter', looksLike: null, confidence: top.p, text: 'That is hard to read as a letter yet. Try it again a little bigger, one clear line for each stroke.', tip: null };
  }
  // The long-and-thin letters look the same once size is taken away: pool their scores, then let the drawn height decide.
  const inFamily = SIZE_FAMILY.includes(targetId);
  const familyP = SIZE_FAMILY.reduce((a, f) => a + result.probs[indexOf(f)], 0);
  let looks = top.id; let pLooks = top.p; let pWant = pTarget;
  if (SIZE_FAMILY.includes(top.id) || (inFamily && familyP >= THRESHOLDS.sure)) {
    if (drawnHeight && heights) { looks = resolveBySize(SIZE_FAMILY.includes(top.id) ? top.id : targetId, drawnHeight, heights); pLooks = familyP; if (inFamily) pWant = looks === targetId ? familyP : 0; }
    else if (inFamily) { looks = targetId; pLooks = familyP; pWant = familyP; }       // no size to go on: do not guess between them
  }
  if (looks === targetId) return { verdict: 'match', looksLike: targetId, confidence: pLooks, text: `That reads as ${label(targetId)}.`, tip: null };
  if (pLooks < THRESHOLDS.sure) return unsure;
  const tip = tipFor(targetId, looks, script);
  if (pWant >= THRESHOLDS.targetOk) return { verdict: 'close', looksLike: looks, confidence: pLooks, text: `Close. It could also be read as ${label(looks)}.${tip ? ' ' + tip : ''}`, tip };
  return { verdict: 'looks-like', looksLike: looks, confidence: pLooks, text: `This looks more like ${label(looks)}. ${tip || `Look at ${NAMES[targetId]} once more and compare the two shapes.`}`, tip };
}

/**
 * A short word, one drawing per letter, right to left as written.
 * @param {{targetId: string, result: {probs: ArrayLike<number>, ranking: {id:string, char:string, p:number}[]}, drawnHeight?: number}[]} cells
 * @param {{script?: 'print'|'cursive', heights?: Record<string, number>}} [o]
 * @returns {{ok: boolean, read: string, firstIssue: number, text: string|null, letters: ReturnType<typeof checkLetter>[]}} one message at most: the first letter that needs a second look
 */
export function checkWord(cells, { script = 'print', heights } = {}) {
  const letters = cells.map((c) => checkLetter(c.result, { targetId: c.targetId, script, drawnHeight: c.drawnHeight, heights }));
  const firstIssue = letters.findIndex((l) => l.verdict === 'looks-like' || l.verdict === 'not-a-letter' || l.verdict === 'close');
  const read = letters.map((l, i) => { const id = l.looksLike || cells[i].targetId; return CLASSES[indexOf(id)].char; }).join('');
  if (firstIssue < 0) return { ok: true, read, firstIssue, text: null, letters };
  const ord = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'][firstIssue] || `number ${firstIssue + 1}`;
  return { ok: false, read, firstIssue, text: `The ${ord} letter: ${letters[firstIssue].text}`, letters };
}
