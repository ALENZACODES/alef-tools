#!/usr/bin/env python3
"""Score a DictaBERT joint model against the app's own word list (Al-Heb data/vocab/words.json) and prefix deck.

The word list is the only labelled Hebrew the app has, so every test item is built from it. Three kinds of item:

  context   a word inside its example sentence (the list's `example.he` and `example.match`), everyday unpointed
            Hebrew from Tatoeba, which is the kind of text the models were trained on.
  verse     the same, where the example is a Bible verse. Kept apart: the models are modern-Hebrew models. The
            divine Name in a verse is replaced with ה׳ before the text goes anywhere (common.mask_divine_name).
  single    a headword or one of its listed forms (plural, present, future, infinitive) on its own, with no
            sentence around it. Pointed in the list, so it is respelled in full first (src/plene.js).
  prefix    the app's prefix deck (data/games/prefix-deck.json, 21 attested words), plus built items: a prefix
            glued to a list noun, where the right split is known because we glued it.

Only "checked" entries are used: the ones the word list does not flag `needsReview` (homographs and entries whose
example may belong to another dictionary entry are flagged there, and an example attached to the wrong entry is not a
fair test of anything) and whose example is not marked `ambiguousMatch`. Pass --all to score every entry instead.

What counts as right:
  lemma     the model's lemma is the list's headword. DictaBERT names a present-tense verb by its present form
            (מסכים) where the list uses the past (הסכים), so the list's own `forms.present` counts as the same entry.
            Where the model has no lemma in its vocabulary it returns a blank; the word without its prefixes is used
            then, as the model's own UD converter does. Spelling: the list's headwords come from pointed text and the
            model writes full spelling, so a match that differs only in vav and yod counts ("pct"); "strictPct" is
            the figure without that allowance.
  pos       the model's tag is one the list's part of speech allows (noun: NOUN or PROPN; verb: VERB or AUX; ...).
  gender    nouns only, where the list has m or f: the model's Gender includes it.
  number    Plur where the test word is exactly the listed plural, Sing where it is exactly the headword of a noun
            or adjective.
  prefix    the letters split off the front are exactly the expected ones (none, where none are expected). In a
            sentence the expected split is known only when the word is exactly a listed form (no prefix) or a prefix
            plus a listed form of a noun, adjective or adverb; verbs are left out, because a present-tense verb
            starts with a mem that is not a prefix.

Writes: <out>/eval-<name>.json (figures), <out>/items.json (the items, for scripts/eval_pack.mjs, which runs the same
test through the browser code path), and with --diff the list of disagreements (review/morph-diff.json).

Usage: python eval_vocab.py --app /path/to/Al-Heb --model dicta-il/dictabert-joint --out out/eval --diff ../review/morph-diff.json
"""
import argparse
import collections
import json
import os
import random

from common import POS_OK, WordList, scrub, load_joint, mask_divine_name, plene, predict, skeleton, strip_marks

GENDER = {'m': 'Masc', 'f': 'Fem'}
PREFIXES = ['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ', 'וה', 'שה', 'מה', 'וב', 'ול', 'כש', 'וכש', 'ומה']


def build_items(app, seed=11, single_cap=2500, built_cap=1300, checked_only=True):
    words = json.load(open(os.path.join(app, 'data/vocab/words.json'), encoding='utf8'))['words']
    words = [w for w in words if w.get('kind') == 'word' and ' ' not in w['he'] and not w['he'].endswith('־') and not (w.get('flags') or {}).get('hidden')
             and not (checked_only and (w.get('flags') or {}).get('needsReview'))]
    heads = [w['he'] for w in words]
    forms = []
    for w in words:
        for k, f in (w.get('forms') or {}).items():
            if isinstance(f, str) and ' ' not in f and k != 'feminine':
                forms.append((w, k, f))
    full = dict(zip(heads + [f for _, _, f in forms], plene(heads + [f for _, _, f in forms])))
    items = []

    def lemma_any(w):
        out = {strip_marks(w['he']), full[w['he']]}
        present = (w.get('forms') or {}).get('present')
        if w['pos'] == 'verb' and isinstance(present, str) and ' ' not in present:
            out |= {strip_marks(present), full.get(present, strip_marks(present))}
        return sorted(out)

    def expect_for(w, kind, surface):
        e = {'lemma': lemma_any(w)}
        if w['pos'] in POS_OK:
            e['pos'] = sorted(POS_OK[w['pos']])
        if w['pos'] == 'noun' and w.get('gender') in GENDER:
            e['gender'] = GENDER[w['gender']]
        if w['pos'] in ('noun', 'adj'):
            plural = (w.get('forms') or {}).get('plural')
            plurals = {strip_marks(plural), full.get(plural)} if isinstance(plural, str) else set()
            heads_ = {strip_marks(w['he']), full[w['he']]}
            if kind == 'plural' or (surface in plurals and surface not in heads_):
                e['number'] = 'Plur'
            elif (kind == 'head' or surface in heads_) and w.get('number') != 'pl' and not (plurals & heads_):
                e['number'] = 'Sing'
            if w.get('number') == 'pl' and kind == 'head':
                e['number'] = 'Plur'
        return e

    # context: the word in its example sentence
    for w in words:
        ex = w.get('example') or {}
        if not ex.get('he') or not ex.get('match') or (ex.get('flags') or {}).get('ambiguousMatch'):
            continue
        match = strip_marks(ex['match'])
        e = expect_for(w, 'context', match)
        variants = {strip_marks(w['he']), full[w['he']]} | {strip_marks(f) for f in (w.get('forms') or {}).values() if isinstance(f, str)} | {full.get(f, '') for f in (w.get('forms') or {}).values() if isinstance(f, str)}
        variants.discard('')
        if match in variants:
            e['prefix'] = ''
        elif w['pos'] in ('noun', 'adj', 'adv'):
            for p in sorted(PREFIXES, key=len, reverse=True):
                if match.startswith(p) and match[len(p):] in variants and len(match) - len(p) >= 2:
                    e['prefix'] = p
                    break
        text, hidden = mask_divine_name(strip_marks(ex['he']))
        kind = 'context' if (ex.get('source') or {}).get('type') == 'tatoeba' else 'verse'
        items.append({'set': kind, 'id': w['id'], 'text': text, 'target': match, 'expect': e})

    rnd = random.Random(seed)
    # single: headwords and listed forms alone
    singles = [(w, 'head', w['he']) for w in words] + forms
    rnd.shuffle(singles)
    for w, kind, f in singles[:single_cap]:
        items.append({'set': 'single', 'id': f"{w['id']}:{kind}", 'text': full[f], 'target': full[f], 'expect': expect_for(w, kind, full[f])})

    # prefix: the app's deck (attested), then built items
    deck = json.load(open(os.path.join(app, 'data/games/prefix-deck.json'), encoding='utf8'))['deck']
    deck_full = plene([d['he'] for d in deck])
    for d, t in zip(deck, deck_full):
        items.append({'set': 'prefix-deck', 'id': d['id'], 'text': t, 'target': t, 'expect': {'prefix': d['prefix']}})
    nouns = [w for w in words if w['pos'] == 'noun' and len(strip_marks(w['he'])) >= 3 and (w.get('frequencyRank') or 9999) <= 3000]
    rnd.shuffle(nouns)
    for i, w in enumerate(nouns[:built_cap]):
        base = full[w['he']]
        p = PREFIXES[i % len(PREFIXES)]
        # a bare noun is a "no prefix" item when it starts with a prefix letter (the hard case), every third item
        if i % 3 == 0 and base[0] in 'ובכלמשה':
            items.append({'set': 'prefix-built', 'id': f"{w['id']}:bare", 'text': base, 'target': base, 'expect': {'prefix': ''}})
        else:
            items.append({'set': 'prefix-built', 'id': f"{w['id']}:{p}", 'text': p + base, 'target': p + base, 'expect': {'prefix': p}})
    return items


def find_target(tokens, target):
    for t in tokens:
        if t['token'] == target:
            return t
    return None


def score(item, tok):
    """-> {field: (ok_lenient, ok_strict)} for the fields this item expects."""
    e, r = item['expect'], {}
    if 'lemma' in e:
        lex = tok['lex'] if tok['lex'] != '[BLANK]' else tok['seg'][-1]
        strict = lex in e['lemma']
        r['lemma'] = (strict or any(skeleton(lex) == skeleton(x) for x in e['lemma']), strict)
    if 'pos' in e:
        ok = tok['morph']['pos'] in e['pos']
        r['pos'] = (ok, ok)
    if 'gender' in e:
        ok = e['gender'] in tok['morph']['feats'].get('Gender', '').split(',')
        r['gender'] = (ok, ok)
    if 'number' in e:
        ok = e['number'] in tok['morph']['feats'].get('Number', '').split(',')
        r['number'] = (ok, ok)
    if 'prefix' in e:
        got = tok['seg'][0] if len(tok['seg']) > 1 else ''
        r['prefix'] = (got == e['prefix'], got == e['prefix'])
    return r


def tally(items, analyses, name):
    counts = collections.defaultdict(lambda: [0, 0, 0])  # (set, field) -> [n, lenient, strict]
    diffs, missing = [], 0
    for item, out in zip(items, analyses):
        tok = find_target(out['tokens'], item['target'])
        if tok is None:
            missing += 1
            continue
        for field, (ok, strict) in score(item, tok).items():
            for key in ((item['set'], field), ('all', field)):
                c = counts[key]
                c[0] += 1
                c[1] += ok
                c[2] += strict
            if not ok:
                got = {'lemma': tok['lex'], 'pos': tok['morph']['pos'], 'gender': tok['morph']['feats'].get('Gender'), 'number': tok['morph']['feats'].get('Number'),
                       'prefix': tok['seg'][0] if len(tok['seg']) > 1 else ''}[field]
                want = item['expect'][field]
                diffs.append({'set': item['set'], 'id': item['id'], 'word': item['target'], 'in': item['text'] if item['text'] != item['target'] else None,
                              'field': field, 'wordList': want, 'model': got})
    table = {}
    for (s, f), (n, ok, strict) in sorted(counts.items()):
        table.setdefault(s, {})[f] = {'n': n, 'right': ok, 'pct': round(100 * ok / n, 2) if n else None, **({'strictPct': round(100 * strict / n, 2)} if f == 'lemma' and n else {})}
    return {'model': name, 'items': len(items), 'targetNotFound': missing, 'bySet': table}, diffs


def link_scores(items, analyses, wl):
    """The shipped path for the dictionary form: the word is linked to ONE word-list entry (common.WordList.link) or to
    none. Scored on the sentence sets only, against the entry the example belongs to. `rightPct` is of the links made;
    `linkedPct` is how many words got a link at all. Note the test words are unpointed here, so the strongest evidence
    the lesson build has (the pointed spelling as shown) is not available to it."""
    out = {}
    for name in ('context', 'verse'):
        n = linked = right = 0
        for item, res in zip(items, analyses):
            if item['set'] != name:
                continue
            tok = find_target(res['tokens'], item['target'])
            if tok is None:
                continue
            n += 1
            wid, how, _ = wl.link(item['target'], item['target'], tok)
            if wid:
                linked += 1
                right += wid == item['id']
        out[name] = {'n': n, 'linked': linked, 'linkedPct': round(100 * linked / n, 2) if n else None, 'right': right, 'rightPct': round(100 * right / linked, 2) if linked else None}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', required=True)
    ap.add_argument('--model', default='dicta-il/dictabert-joint')
    ap.add_argument('--out', required=True)
    ap.add_argument('--diff')
    ap.add_argument('--all', action='store_true', help='score every entry, flagged ones too')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    items = build_items(a.app, checked_only=not a.all)
    name = a.model.split('/')[-1] + ('-all' if a.all else '')
    if not a.all:
        json.dump(items, open(os.path.join(a.out, 'items.json'), 'w', encoding='utf8'), ensure_ascii=False)
    # the model's answers are kept between runs, keyed by text, so a change to the scoring does not re-run the model
    cache_path = os.path.join(a.out, f"cache-{a.model.split('/')[-1]}.json")
    cache = json.load(open(cache_path, encoding='utf8')) if os.path.exists(cache_path) else {}
    todo = sorted({i['text'] for i in items} - set(cache))
    if todo:
        model, tok = load_joint(a.model)
        for text, out in zip(todo, predict(model, tok, todo)):
            cache[text] = {'tokens': [{'token': t['token'], 'lex': t['lex'], 'seg': list(t['seg']), 'morph': {'pos': t['morph']['pos'], 'feats': t['morph']['feats']}} for t in out['tokens']]}
        json.dump(cache, open(cache_path, 'w', encoding='utf8'), ensure_ascii=False)
    analyses = [cache[i['text']] for i in items]
    report, diffs = tally(items, analyses, a.model)
    report['dictionaryLink'] = link_scores(items, analyses, WordList(a.app))
    json.dump(report, open(os.path.join(a.out, f'eval-{name}.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    if a.diff:
        json.dump({'schema': 'alef.morph.diff/1', 'model': a.model,
                   'note': 'Every place the model and the app word list disagree on the test items. Neither side is assumed right: the word list is unreviewed too. A person decides each one.',
                   'count': len(diffs), 'figures': report['bySet'], 'dictionaryLink': report['dictionaryLink'], 'items': scrub(diffs)}, open(a.diff, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
