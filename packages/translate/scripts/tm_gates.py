# ruff: noqa: E401, E701, E702, E731, E741
"""Checks every translation-memory entry must pass before it may ship. Pure Python, no model and no install needed,
so the same checks run in CI (tests/test_tm_gates.py) and inside scripts/build-tm.py.

An entry is a Hebrew sentence of the app (its key: unpointed, punctuation dropped) and an English line.
  held      the Hebrew holds the four-letter Name: never translated, never stored, never listed for review.
  sacred    scripture, prayer or any cited source text: never machine translated (those screens quote and cite).
  shape     the English is a plausible line: not empty, no Hebrew letters, no loop of one word, a sane length for the Hebrew.
  numbers   the numbers said in the Hebrew are the numbers said in the English (the app's own number forms, data/talk/pack.json).
  person    "I" stays "I", "we" stays "we", and "she" does not turn into "he" (or the reverse).
  count     a noun the app knows in the plural stays plural, and a singular stays singular (the app's own noun list with plurals).
  round trip (machine-made entries only) the English, translated back by the other pack, still reads like the Hebrew.
  agreement  (machine-made entries only) the ordinary Hebrew to English pack, asked the same sentence, lands close to it.
An entry that fails anything goes to review/tm-needs-human.json with the reason. It does not go into the app.
"""
import re
import unicodedata

MARKS = re.compile('[֑-ֽֿ-ׇ]')
CANTILLATION = re.compile('[֑-֯]')
HE = re.compile('[א-ת]')
PREFIX = '[ובלמכשה]'  # one-letter prefixes: and, in, to, from, as, that, the
NAME = 'יהוה'
LATIN_NAME = re.compile(r'\b(?:yhwh|yhvh|yahweh|yahveh|yahwe|jehovah|yehovah|yehova|yehwah)\b', re.I)
DIVINE = re.compile('(?:^| )' + PREFIX + '{0,2}(?:' + '|'.join([
    NAME, 'אדני', 'אלהים', 'אלוהים', 'אלהינו', 'אלוהינו',
    'אלהי', 'אלהיך', 'אלוהי']) + ')(?= |$)')
SACRED_PATHS = ('ask/', 'corpus/torah', 'corpus/reader', 'corpus/trope', 'corpus/registry', 'torahread', 'torahstudy', 'torah-quotes', 'morning-verses',
                'homepage/prayers', 'games/g5', 'games/mitzvot', 'festivals/', 'grammar/spotlights', 'typing/', 'service/', 'trope-trainer', 'traditions/', 'listen/', 'calendar/')


def tm_key(he):
    """The key of a Hebrew line: vowel points and cantillation dropped, punctuation to spaces, spaces collapsed.
    src/tm.js builds the same key in the browser (tests/fixtures/tm-keys.json holds lines both must agree on)."""
    s = unicodedata.normalize('NFKC', str(he or ''))
    s = MARKS.sub('', s).replace('־', ' ')
    s = re.sub(r'[^0-9A-Za-zא-ת]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip().lower()


def fnv1a(s):
    h = 0x811C9DC5
    for b in s.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def he_words(key):
    return [w for w in key.split(' ') if HE.search(w)]


def holds_name(text):
    k = tm_key(text)
    return any(NAME in w and re.fullmatch(PREFIX + '{0,3}' + NAME, w) for w in k.split(' ')) or bool(LATIN_NAME.search(str(text or '')))


def is_sacred(he, path='', record=None):
    """Scripture, prayer, or a cited source line. These are never machine translated."""
    record = record or {}
    if any(p in path for p in SACRED_PATHS): return True
    if any(k in record for k in ('ref', 'verse', 'parasha', 'formula')): return True
    raw = str(he or '')
    if CANTILLATION.search(raw) or '\u05C3' in raw or '\u05BE' in raw: return True   # cantillation, a verse end, or the joining dash of scripture
    return bool(DIVINE.search(tm_key(raw)))


# ---- numbers -------------------------------------------------------------------------------------------------------
EN_UNITS = {'zero': 0, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13,
            'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50,
            'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90, 'both': 2, 'couple': 2, 'pair': 2, 'twice': 2, 'dozen': 12}
# Hebrew number words in everyday spelling and in the shorter spelling a pointed line has once its points are dropped.
HE_UNITS = {2: 'שתיים שתים שניים שתי לשנים שעתיים יומיים שבועיים שנתיים חודשיים פעמיים שניהם שתיהן זוג', 12: 'תריסר', 3: 'שלוש שלש שלושה שלשה שלושת', 4: 'ארבע ארבעה ארבעת', 5: 'חמש חמישה חמשה חמשת', 6: 'שש שישה ששה ששת',
            7: 'שבעה שבעת', 8: 'שמונה שמנה שמונת', 9: 'תשע תשעה תשעת', 10: 'עשר עשרה עשרת', 20: 'עשרים', 30: 'שלושים שלשים', 40: 'ארבעים', 50: 'חמישים חמשים',
            60: 'שישים ששים', 70: 'שבעים', 80: 'שמונים', 90: 'תשעים', 100: 'מאה', 200: 'מאתיים מאתים', 1000: 'אלף', 2000: 'אלפיים אלפים'}
HE_NUM = {w: n for n, ws in HE_UNITS.items() for w in ws.split()}
ONE_HE = ('אחד', 'אחת')          # "one" and "a": counted only inside eleven (אחת עשרה)
TWO_HE = 'שני'                    # "two" before a noun; "second" after one (היום השני, יום שני)
TEEN_HE = ('עשר', 'עשרה')
STRIP = 'ובלמכה'


def number_forms(app_numbers):
    """Hebrew number word -> value: the table above plus the app's own forms (data/talk/pack.json numbers.list)."""
    out = dict(HE_NUM)
    for row in (app_numbers or {}).get('list', []):
        n = row.get('n')
        if not isinstance(n, int) or n < 2: continue
        for f in ('count', 'm', 'mConstruct', 'fConstruct'):
            w = row.get(f)
            if isinstance(w, str) and ' ' not in w and w != TWO_HE and w != 'שבע': out.setdefault(w, n)
    return out


def numbers_he(key, forms):
    """The numbers a Hebrew line says, as a list of values (compound numbers come out as their parts, or joined)."""
    words = key.split(' '); got = []
    for i, w in enumerate(words):
        if w.isdigit(): got.append(int(w)); continue
        bare = w[1:] if len(w) > 2 and w[0] in STRIP and (w[1:] in forms or w[1:] in ('שבע', 'שנים')) else w
        nxt = words[i + 1] if i + 1 < len(words) else ''
        prev = words[i - 1] if i else ''
        if bare in ONE_HE and nxt in TEEN_HE: got.append(1); continue
        if bare == 'מאות' and got and got[-1] < 10 and prev: got[-1] *= 100; continue
        if bare == 'אלפים' and got and 2 < got[-1] <= 10 and prev: got[-1] *= 1000; continue
        if w == TWO_HE or (len(w) == 4 and w[0] in 'ובלמכ' and w[1:] == TWO_HE):
            if nxt and not prev.endswith('יום') and not nxt.isdigit(): got.append(2)
            continue
        if bare == 'שנים' and nxt in TEEN_HE: got.append(2); continue
        if bare == 'שבע' and prev not in ('אני', 'אתה', 'את', 'הוא', 'לא', 'כבר'): got.append(7); continue   # שבע is also "full" (of food)
        if bare in forms: got.append(forms[bare])
    return got


def numbers_en(en):
    got = []
    for w in re.findall(r"[a-z]+|\d+", str(en or '').lower()):
        if w.isdigit(): got.append(int(w))
        elif w in EN_UNITS: got.append(EN_UNITS[w])
        elif w == 'hundred': got[-1:] = [got[-1] * 100] if got and 1 < got[-1] < 10 else got[-1:] + [100]
        elif w == 'thousand': got[-1:] = [got[-1] * 1000] if got and 1 < got[-1] < 1000 else got[-1:] + [1000]
    return got


def check_numbers(key, en, forms):
    h, e = sorted(numbers_he(key, forms)), sorted(numbers_en(en))
    if h == e: return None
    if h and e and sum(h) == sum(e): return None   # twenty three / עשרים ושלוש, thirteen / שלוש עשרה
    return f'numbers differ: Hebrew {h} English {e}'


# ---- person --------------------------------------------------------------------------------------------------------
I_EN = re.compile(r"\b(?:i|i'm|i've|i'll|i'd|me|my|mine|myself|im)\b", re.I)
WE_EN = re.compile(r"\b(?:we|we're|we've|we'll|we'd|us|our|ours|let's|ourselves)\b", re.I)
HE_EN = re.compile(r"\b(?:he|he's|him|his|himself)\b", re.I)
SHE_EN = re.compile(r"\b(?:she|she's|her|hers|herself)\b", re.I)
IT_EN = re.compile(r"\b(?:it|it's|its|this|that|they|there)\b", re.I)


def check_person(key, en):
    words = set(key.split(' '))
    e = str(en or '').replace('’', "'")
    if 'אני' in words and not I_EN.search(e): return 'the Hebrew says "I" and the English does not'
    if 'אנחנו' in words and not WE_EN.search(e): return 'the Hebrew says "we" and the English does not'
    she, he = 'היא' in words, 'הוא' in words
    if she and not he and HE_EN.search(e) and not SHE_EN.search(e): return 'the Hebrew says "she" and the English says "he"'
    if he and not she and SHE_EN.search(e) and not HE_EN.search(e) and not IT_EN.search(e): return 'the Hebrew says "he" and the English says "she"'
    return None


# ---- count (singular and plural of nouns the app knows) -------------------------------------------------------------
IRREGULAR = {'man': 'men', 'woman': 'women', 'child': 'children', 'person': 'people', 'foot': 'feet', 'tooth': 'teeth', 'knife': 'knives', 'loaf': 'loaves', 'shelf': 'shelves'}
UNCOUNTED = {'water', 'bread', 'rice', 'money', 'fish', 'luggage', 'information', 'news', 'coffee', 'tea', 'wine', 'milk', 'meat', 'fruit', 'hair', 'help', 'homework', 'glasses', 'scissors', 'pants', 'trousers', 'clothes', 'people', 'police', 'change'}


def plural_en(word):
    if word in IRREGULAR: return IRREGULAR[word]
    if re.search(r'(?:s|x|z|ch|sh)$', word): return word + 'es'
    if re.search(r'[^aeiou]y$', word): return word[:-1] + 'ies'
    return word + 's'


def noun_table(app_nouns):
    """[(singular he, plural he, singular en, plural en)] for one-word nouns of the app that list a plural."""
    rows = []
    for n in app_nouns or []:
        he, pl, en = n.get('he'), n.get('pl'), (n.get('en') or [None])[0]
        if not (isinstance(he, str) and isinstance(pl, str) and isinstance(en, str)): continue
        if ' ' in he or ' ' in pl or ' ' in en or en in UNCOUNTED or he == pl: continue
        rows.append((he, pl, en.lower(), plural_en(en.lower())))
    return rows


def _has(words, form):
    return any(w == form or (len(w) > len(form) and w.endswith(form) and re.fullmatch(PREFIX + '{1,2}', w[:len(w) - len(form)])) for w in words)


def check_count(key, en, nouns, forms):
    words = key.split(' ')
    if numbers_he(key, forms) or any(w.isdigit() for w in words): return None  # after a number Hebrew may keep the singular (עשרים שקל)
    e = set(re.findall(r"[a-z]+", str(en or '').lower()))
    for he, pl, sg_en, pl_en in nouns:
        has_sg, has_pl = _has(words, he), _has(words, pl)
        if has_pl and not has_sg and sg_en in e and pl_en not in e: return f'the Hebrew has the plural {pl} and the English has "{sg_en}"'
        if has_sg and not has_pl and pl_en in e and sg_en not in e: return f'the Hebrew has the singular {he} and the English has "{pl_en}"'
    return None


# ---- shape ---------------------------------------------------------------------------------------------------------
def check_shape(key, en):
    e = str(en or '').strip()
    if not e: return 'no English'
    if HE.search(e): return 'Hebrew letters in the English'
    if '�' in e or len(e) > 400: return 'broken or overlong English'
    if LATIN_NAME.search(e): return 'the English spells the Name'
    ew = re.findall(r"[A-Za-z0-9']+", e); hw = he_words(key)
    if not ew: return 'no English words'
    for i in range(len(ew) - 3):
        if len({w.lower() for w in ew[i:i + 4]}) == 1: return 'one word repeated'
    ratio = len(ew) / max(1, len(hw))
    if ratio < 0.34 or ratio > 4.5: return f'length looks wrong ({len(hw)} Hebrew words, {len(ew)} English words)'
    return None


def check_machine_shape(en):
    """Extra shape check for machine-made lines: a word said twice in a row is the mark of a stuck model."""
    ew = [w.lower() for w in re.findall(r"[A-Za-z']+", str(en or ''))]
    return 'a word is said twice in a row' if any(a == b and len(a) > 2 for a, b in zip(ew, ew[1:])) else None


def rule_checks(key, en, forms, nouns):
    """All the rule checks. Returns a list of reasons (empty when the entry passes)."""
    return [r for r in (check_shape(key, en), check_numbers(key, en, forms), check_person(key, en), check_count(key, en, nouns, forms)) if r]


# ---- round trip ----------------------------------------------------------------------------------------------------
def _grams(s, n):
    s = re.sub(r'\s+', '', s); out = {}
    for i in range(len(s) - n + 1): out[s[i:i + n]] = out.get(s[i:i + n], 0) + 1
    return out


def chrf(hyp, ref, order=6, beta=2.0):
    """chrF2 of one line pair, 0 to 100 (the arithmetic of src/scoring.js and of sacreBLEU)."""
    p = r = 0.0; eff = 0
    for n in range(1, order + 1):
        hg, rg = _grams(hyp, n), _grams(ref, n)
        nh, nr = sum(hg.values()), sum(rg.values())
        if nh and nr:
            m = sum(min(c, hg.get(g, 0)) for g, c in rg.items())
            p += m / nh; r += m / nr; eff += 1
    if not eff: return 0.0
    p /= eff; r /= eff
    f = beta * beta
    return 100 * (1 + f) * p * r / (f * p + r) if p + r else 0.0


ROUND_TRIP_MIN = 60.0


def check_round_trip(key, back):
    """`back` is the English translated back to Hebrew by the other pack."""
    score = chrf(tm_key(back), key)
    return (None if score >= ROUND_TRIP_MIN else f'round trip {score:.0f} (needs {ROUND_TRIP_MIN:.0f}): came back as "{back}"'), score


AGREE_MIN = 45.0


def check_agreement(en, second):
    """`second` is the same Hebrew translated by the ordinary pack. Two models that land far apart: a person decides."""
    norm = lambda x: re.sub(r'[^a-z0-9 ]+', ' ', str(x or '').lower().replace('\u2019', "'").replace("'", ''))
    score = max(chrf(norm(en), norm(second)), chrf(norm(second), norm(en)))
    return (None if score >= AGREE_MIN else f'the two packs disagree ({score:.0f}, needs {AGREE_MIN:.0f}): the ordinary pack says "{second}"'), score
