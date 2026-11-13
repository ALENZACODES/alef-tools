#!/usr/bin/env python3
"""Find example sentences in the app word list that illustrate a different word than their entry.

  python sweep_examples.py --app <Al-Heb> --out ../review/example-sweep.json [--cache work/sweep-cache.json]

The word list (data/vocab/words.json) attached each example by matching letters, so a sentence can sit under a word
that only shares its spelling (מסירה "delivery" under a sentence where מסירה is "I take off"). Every example is read
by dicta-il/dictabert-joint in its own sentence, and the word the entry matched (`example.match`) is compared with
the entry:

  keep   the model's dictionary form for that word is the entry's headword (or its listed present form, which is
         how the model names a present-tense verb), allowing vav/yod spelling differences, and the model's part of
         speech is one the entry's part of speech allows
  hold   the dictionary form is a different word, or the part of speech cannot be the entry's
  hold   the word is read as a name and the sentence's English shares no word with the entry's meaning (מג "mage" under "Meg must carry on her studies")
  hold   the model gave no dictionary form and the part of speech cannot be the entry's
  keep   the model gave no dictionary form but the part of speech fits ("unconfirmed": nothing says it is wrong).
         A form that is only the inflected word handed back, or a cut-off piece of it, counts as no dictionary form.
  keep   the dictionary form differs, but the part of speech fits and the word is letter for letter a form the entry
         lists (its plural, present, future, infinitive)
  keep   the dictionary form differs and the part of speech fits, but a second model (dictabert-parse) reads the word
         as the entry's: the first model's dictionary forms are often wrong for rarer verbs
  keep   entries with no part of speech to compare (phrases, "unknown"), unless the dictionary form is another word

Nothing is rewritten here and no sentence is invented. The output lists every example with its verdict and the
evidence; the app repo turns the holds into entries of data/vocab/corrections.json. The divine Name is replaced
before a verse reaches the model and is never written to the output.
"""
import argparse
import collections
import json
import os
import re
import unicodedata

from common import POS_OK, load_joint, mask_divine_name, plene, predict, revision, scrub, skeleton, strip_marks

MODEL = 'dicta-il/dictabert-joint'
STOP = {'the', 'and', 'for', 'with', 'that', 'this', 'from', 'something', 'someone', 'one', 'not', 'you', 'are', 'who', 'which', 'into', 'male', 'female', 'person', 'used', 'form', 'etc'}


def vowels(text):
    """Pointed text with the cantillation marks and the maqaf taken off, vowels kept."""
    return re.sub('[\u0591-\u05AF\u05BD\u05BE\u05BF\u05C0\u05C3-\u05C6]', '', unicodedata.normalize('NFC', text))


def stems(text):
    """The first four letters of every English word of three letters or more, small words left out."""
    return {x[:4] for x in re.findall('[a-z]{3,}', text.lower()) if x not in STOP}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cache')
    ap.add_argument('--second', default='dicta-il/dictabert-parse', help='a second model asked only about doubtful holds; empty to skip')
    ap.add_argument('--second-cache')
    a = ap.parse_args()
    words = json.load(open(os.path.join(a.app, 'data/vocab/words.json'), encoding='utf8'))['words']
    todo = [w for w in words if (w.get('example') or {}).get('he') and (w.get('example') or {}).get('match')]
    pointed = sorted({w['he'] for w in todo} | {f for w in todo for f in (w.get('forms') or {}).values() if isinstance(f, str)})
    full = dict(zip(pointed, plene(pointed)))
    texts = {w['id']: mask_divine_name(strip_marks(w['example']['he']))[0] for w in todo}

    cache = json.load(open(a.cache, encoding='utf8')) if a.cache and os.path.exists(a.cache) else {}
    missing = sorted(set(texts.values()) - set(cache))
    if missing:
        model, tok = load_joint(MODEL)
        for text, out in zip(missing, predict(model, tok, missing)):
            cache[text] = {'tokens': [{'token': t['token'], 'lex': t['lex'], 'seg': list(t['seg']), 'morph': {'pos': t['morph']['pos'], 'feats': t['morph']['feats']}} for t in out['tokens']]}
        if a.cache:
            json.dump(cache, open(a.cache, 'w', encoding='utf8'), ensure_ascii=False)

    rows, counts = [], collections.Counter()
    for w in todo:
        ex = w['example']
        match = strip_marks(ex['match'])
        tok = next((t for t in cache[texts[w['id']]]['tokens'] if t['token'] == match), None)
        kind = (ex.get('source') or {}).get('type') or 'other'
        row = {'id': w['id'], 'he': w['he'], 'pos': w['pos'], 'en': w['en'], 'match': match, 'sentence': texts[w['id']], 'source': kind}
        if tok is None:
            row.update(verdict='keep', why='not-read', note='the matched word was not found as one word in the sentence as the model reads it')
        else:
            names = {strip_marks(w['he']), full[w['he']]}
            if w['pos'] in ('adj', 'noun'):
                # the model often names an adjective by its feminine form (עקומה for עקום): the same word
                names |= {n + 'ה' for n in list(names) if not n.endswith('ה')}
            listed = set(names)
            for f in (w.get('forms') or {}).values():
                if isinstance(f, str) and ' ' not in f:
                    listed |= {strip_marks(f), full[f]}
            present = (w.get('forms') or {}).get('present')
            if w['pos'] == 'verb' and isinstance(present, str) and ' ' not in present:
                names |= {strip_marks(present), full[present]}
            lemma = tok['lex'] if tok['lex'] != '[BLANK]' else None
            pos = tok['morph']['pos']
            feats = tok['morph']['feats']
            base = tok['seg'][-1]
            same = lemma is not None and any(skeleton(lemma) == skeleton(n) for n in names)
            # A dictionary form that is only the word itself handed back while the word is plainly inflected (plural,
            # feminine, or a verb said of "I" or "you"), or a cut-off piece of it, tells us nothing: treat it as no dictionary form.
            if lemma is not None and not same:
                echo = lemma == base and (feats.get('Number') in ('Plur', 'Dual') or feats.get('Gender') == 'Fem' or feats.get('Person') in ('1', '2'))
                cut = len(lemma) >= 2 and len(lemma) < len(base) and base.startswith(lemma)
                if echo or cut:
                    lemma = None
            pos_ok = w['pos'] not in POS_OK or pos in POS_OK[w['pos']]
            # a common noun read as a name (מג "mage" in a sentence about Meg): the entry's English is not capitalised
            # and the sentence's own English shares no word with the entry's meaning. Verses carry no English: not judged here.
            english = ex.get('en') or ''
            as_name = pos == 'PROPN' and bool(english) and not (stems(w['en'] + ' ' + ' '.join(w.get('alt') or [])) & stems(english))
            row.update(modelLemma=tok['lex'] if tok['lex'] != '[BLANK]' else None, modelPos=pos)
            # a pointed verse whose word carries exactly the entry's own vowels is the entry's word, whatever the model
            # makes of the unpointed letters; only a name spelled the same way (פרץ the man) still counts against it
            if ex.get('hePointed') and pos != 'PROPN' and vowels(ex['match']) == vowels(w['he']):
                row.update(verdict='keep', why='same-pointing')
            elif as_name:
                row.update(verdict='hold', why='used-as-a-name')
            elif lemma is None:
                row.update(verdict='keep' if pos_ok else 'hold', why='no-lemma-pos-fits' if pos_ok else 'no-lemma-pos-differs')
            elif same and pos_ok:
                row.update(verdict='keep', why='same-word')
            elif same:
                row.update(verdict='hold', why='same-letters-other-part-of-speech')
            elif pos_ok and base in listed:
                # the model names another dictionary form, but the word is letter for letter a form the entry lists and the
                # part of speech fits: the model's dictionary form is the weaker evidence (it is often wrong for rarer verbs)
                row.update(verdict='keep', why='listed-form')
            else:
                row.update(verdict='hold', why='other-word', posFits=pos_ok)
        counts[row['verdict'] + ':' + row['why']] += 1
        counts[kind + ':' + row['verdict']] += 1
        rows.append(row)
    # Second opinion, only where the part of speech fits and the dictionary form alone says "other word".
    doubtful = [r for r in rows if r['why'] == 'other-word' and r.get('posFits')]
    if a.second and doubtful:
        second_cache = json.load(open(a.second_cache, encoding='utf8')) if a.second_cache and os.path.exists(a.second_cache) else {}
        need = sorted({r['sentence'] for r in doubtful} - set(second_cache))
        if need:
            model2, tok2 = load_joint(a.second)
            for text, out in zip(need, predict(model2, tok2, need)):
                second_cache[text] = {'tokens': [{'token': t['token'], 'lex': t['lex'], 'pos': t['morph']['pos']} for t in out['tokens']]}
            if a.second_cache:
                json.dump(second_cache, open(a.second_cache, 'w', encoding='utf8'), ensure_ascii=False)
        by_id = {w['id']: w for w in todo}
        for r in doubtful:
            w = by_id[r['id']]
            t2 = next((t for t in second_cache[r['sentence']]['tokens'] if t['token'] == r['match']), None)
            if not t2 or t2['lex'] == '[BLANK]':
                continue
            names = {strip_marks(w['he']), full[w['he']]}
            present = (w.get('forms') or {}).get('present')
            if w['pos'] == 'verb' and isinstance(present, str) and ' ' not in present:
                names |= {strip_marks(present), full[present]}
            r['secondLemma'] = t2['lex']
            if any(skeleton(t2['lex']) == skeleton(n) for n in names) and (w['pos'] not in POS_OK or t2['pos'] in POS_OK[w['pos']]):
                counts['hold:other-word'] -= 1
                counts[r['source'] + ':hold'] -= 1
                r.update(verdict='keep', why='second-opinion-same-word')
                counts['keep:second-opinion-same-word'] += 1
                counts[r['source'] + ':keep'] += 1
    for r in rows:
        r.pop('posFits', None)
    doc = {'schema': 'alef.morph.example-sweep/1', 'model': MODEL, 'revision': revision(MODEL), 'secondModel': a.second or None, 'entries': len(words), 'examples': len(todo),
           'held': sum(1 for r in rows if r['verdict'] == 'hold'), 'counts': dict(sorted(counts.items())),
           'note': 'A hold means the model read the matched word as a different word or a different part of speech than the entry. The model is right about most of these, not all: a hold takes the example off the entry, it does not say the entry is wrong.',
           'rows': rows}
    json.dump(scrub(doc), open(a.out, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    print(json.dumps({k: doc[k] for k in ('entries', 'examples', 'held', 'counts')}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
