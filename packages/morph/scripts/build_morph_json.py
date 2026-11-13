#!/usr/bin/env python3
"""Build the per-unit word-tap data: src/data/morph/<unit>.js, src/data/morph/units.js and src/data/morph/roots.js
(one-line ES modules: `export default {...};`; scripts/build-dist.mjs at the repo root copies them to dist/).

  node scripts/collect_text.mjs --app <Al-Heb> --out work/segments.json
  python scripts/build_morph_json.py --app <Al-Heb> --segments work/segments.json --out src/data/morph --review review

Every stretch of Hebrew a lesson shows is read once by dicta-il/dictabert-joint (pinned in models.manifest.json), in
everyday full spelling. Each word then gets, where one dictionary entry fits, a link to the app's own word list
(common.WordList). What the card shows comes from two places and the file says which:
  from the word list (through the link): the dictionary form with its points, the English, the family letters (root)
      and the verb pattern (binyan). A root is only ever taken from the word list; nothing here invents one.
  from the model: the prefix split, part of speech, gender, number, person, tense, a possessive ending, and whether
      the word is a name or a place.
Where the two disagree (the list says noun, the model says verb) the word goes to review/lesson-words.json and the
card keeps to what both agree on.

Unit module (schema alef.morph.unit/1), default export:
  { unit, words: { "<letters without points>": [ analysis, ... ] }, entries: { "<list id>": {he,en,pos,gender,root,binyan,rootChecked} } }
  analysis = { l lemma, p prefix letters, s part of speech, g gender, n number, r person, t tense,
               sf possessive/object ending {g,n,r}, dt 1 when a prefix also carries "the", e name tag, d list id, how (how the link was made), c [context keys] }
A word with more than one analysis in a unit carries `c`: the keys (src/text.js contextKey) of the sentences each
one belongs to. The four-letter Name has no entry anywhere, and neither does a single letter shown on its own.
"""
import argparse
import collections
import json
import os
import unicodedata

from common import POS_OK, WordList, is_divine_name, load_joint, predict, revision, strip_marks, write_module

MODEL = 'dicta-il/dictabert-joint'
GENDER = {'Masc': 'm', 'Fem': 'f', 'Fem,Masc': 'mf'}
NUMBER = {'Sing': 'sg', 'Plur': 'pl', 'Dual': 'du', 'Plur,Sing': 'sg/pl', 'Dual,Plur': 'du/pl'}
TENSE = {'Past': 'past', 'Fut': 'future', 'Pres': 'present', 'Imp': 'command'}
KEEP_NER = {'PER', 'GPE', 'LOC', 'ORG', 'FAC'}


def analysis_of(tok, entry_id, how):
    f = tok['morph']['feats']
    a = {'l': tok['lex'] if tok['lex'] != '[BLANK]' else None, 'p': tok['seg'][0] if len(tok['seg']) > 1 else '', 's': tok['morph']['pos']}
    if f.get('Gender'):
        a['g'] = GENDER[f['Gender']]
    if f.get('Number'):
        a['n'] = NUMBER[f['Number']]
    if f.get('Person') and f['Person'] != '1,2,3':
        a['r'] = f['Person']
    if f.get('Tense'):
        a['t'] = TENSE[f['Tense']]
    if tok['morph'].get('suffix'):
        sf = tok['morph'].get('suffix_feats') or {}
        a['sf'] = {k: v for k, v in (('g', GENDER.get(sf.get('Gender'))), ('n', NUMBER.get(sf.get('Number'))), ('r', sf.get('Person'))) if v}
    if a['p'] and 'ה' not in a['p'] and 'DET' in (tok['morph'].get('prefixes') or []):
        a['dt'] = 1  # the prefix swallowed a "the" (ba-, la-, ka-)
    ner = tok.get('ner', 'O')
    if ner != 'O' and ner[2:] in KEEP_NER:
        a['e'] = ner[2:]
    if entry_id:
        a['d'] = entry_id
        a['how'] = how
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', required=True)
    ap.add_argument('--segments', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--review', required=True)
    ap.add_argument('--cache', help='keep the model answers here between runs')
    a = ap.parse_args()
    data = json.load(open(a.segments, encoding='utf8'))
    segs = data['segments']
    wl = WordList(a.app)

    cache = json.load(open(a.cache, encoding='utf8')) if a.cache and os.path.exists(a.cache) else {}
    todo = sorted({s['model'] for s in segs.values()} - set(cache))
    if todo:
        model, tok = load_joint(MODEL)
        for text, out in zip(todo, predict(model, tok, todo, per_token_ner=True)):
            cache[text] = [{'token': t['token'], 'start': t['offsets']['start'], 'end': t['offsets']['end'], 'lex': t['lex'], 'seg': list(t['seg']),
                            'morph': {k: t['morph'][k] for k in ('pos', 'feats', 'prefixes', 'suffix') if k in t['morph']} | ({'suffix_feats': t['morph']['suffix_feats']} if t['morph'].get('suffix') else {}),
                            'ner': t.get('ner', 'O')} for t in out['tokens']]
        if a.cache:
            json.dump(cache, open(a.cache, 'w', encoding='utf8'), ensure_ascii=False)

    # one analysis per shown word per segment
    per_seg, review, stats = {}, [], collections.Counter()
    for key, s in segs.items():
        toks = cache[s['model']]
        out = []
        for w in s['words']:
            stats['words'] += 1
            if w.get('name') or is_divine_name(w['shown']):
                stats['name'] += 1
                out.append(None)
                continue
            if sum('א' <= ch <= 'ת' for ch in w['key']) < 2:
                stats['singleLetter'] += 1  # a letter shown on its own in a letters lesson is not a word: no notes
                out.append(None)
                continue
            mine = [t for t in toks if w['start'] <= t['start'] < w['end']]
            if not mine:
                stats['noToken'] += 1
                out.append(None)
                continue
            if len(mine) > 1:
                stats['splitByModel'] += 1
            t = mine[0]
            if t['lex'] != '[BLANK]' and is_divine_name(t['lex']):
                t = dict(t, lex='[BLANK]')
            entry_id, how, cands = wl.link(w['shown'], w['key'], t)
            stats['link:' + how] += 1
            an = analysis_of(t, entry_id, how)
            # The points settle what unpointed letters leave open: a present-tense form or adjective that ends in
            # kamatz + he is feminine, in segol + he masculine (רוֹצָה / רוֹצֶה). The model only saw the letters.
            if an.get('t') == 'present' or an['s'] == 'ADJ':
                shown = unicodedata.normalize('NFD', w['shown'])
                if shown.endswith('\u05b8\u05d4') and an.get('g') == 'm':
                    an['g'] = 'f'
                    stats['genderFromPoints'] += 1
                elif shown.endswith('\u05b6\u05d4') and an.get('g') == 'f':
                    an['g'] = 'm'
                    stats['genderFromPoints'] += 1
            if entry_id:
                e = wl.by_id[entry_id]
                # the dictionary entry is the whole word (בְּבַקָּשָׁה, לְהִתְרָאוֹת): its first letter is not shown as a prefix
                if an['p'] and strip_marks(e['he']) == w['key']:
                    an['p'] = ''
                    an.pop('dt', None)
                if e['pos'] in POS_OK and t['morph']['pos'] not in POS_OK[e['pos']]:
                    review.append({'kind': 'part-of-speech', 'word': w['shown'], 'in': s['model'], 'wordList': e['pos'], 'model': t['morph']['pos'], 'entry': entry_id})
                    for k in ('g', 'n', 't', 'r'):
                        an.pop(k, None)
                    an['s'] = None
                elif e['pos'] == 'noun' and e.get('gender') in ('m', 'f') and an.get('g') in ('m', 'f') and an['g'] != e['gender']:
                    review.append({'kind': 'gender', 'word': w['shown'], 'in': s['model'], 'wordList': e['gender'], 'model': an['g'], 'entry': entry_id})
                    an.pop('g', None)
            elif how == 'unclear':
                review.append({'kind': 'which-entry', 'word': w['shown'], 'in': s['model'], 'candidates': [{'id': c, 'he': wl.by_id[c]['he'], 'en': wl.by_id[c]['en'], 'pos': wl.by_id[c]['pos']} for c in cands[:8]], 'modelLemma': an['l'], 'modelPos': an['s']})
            if an['l'] is None:
                stats['noLemma'] += 1
            out.append((w['key'], an))
        per_seg[key] = out

    os.makedirs(a.out, exist_ok=True)
    index, biggest = {}, 0
    for unit, u in data['units'].items():
        words, entries = {}, {}
        for skey in u['segments']:
            for item in per_seg[skey]:
                if not item:
                    continue
                wkey, an = item
                bucket = words.setdefault(wkey, [])
                bare = {k: v for k, v in an.items()}
                for have in bucket:
                    if {k: v for k, v in have.items() if k != 'c'} == bare:
                        have['c'].append(skey)
                        break
                else:
                    bucket.append(dict(bare, c=[skey]))
                if an.get('d'):
                    entries[an['d']] = wl.card(an['d'])
        for bucket in words.values():
            bucket.sort(key=lambda x: -len(x['c']))
            if len(bucket) == 1:
                bucket[0].pop('c')
        doc = {'schema': 'alef.morph.unit/1', 'unit': unit, 'words': dict(sorted(words.items())), 'entries': dict(sorted(entries.items()))}
        assert 'יהוה' not in json.dumps(doc, ensure_ascii=False)
        size = write_module(os.path.join(a.out, f'{unit}.js'), doc, unit)
        biggest = max(biggest, size)
        index[unit] = {'words': len(words), 'bytes': size}
    assert biggest <= 300 * 1024, f'a unit file is {biggest} bytes: over the 300 KiB budget'

    # lemma -> family letters, for words analysed on the device (the pack path). Only entries whose headword spelling
    # points at exactly one set of letters are listed, and every root here is copied from the app's word list.
    roots = collections.defaultdict(set)
    for wid, w in wl.by_id.items():
        if w.get('root'):
            for form, lst in wl.by_form.items():
                if any(i == wid and kind in ('head', 'present') for i, kind in lst):
                    roots[form].add((w['root'], w.get('binyan') or '', w['root'] in wl.verified_roots))
    roots_doc = {'schema': 'alef.morph.roots/1', 'source': 'Al-Heb data/vocab/words.json (root, binyan) and data/roots/verified.json',
                 'lemmas': {k: [next(iter(v))[0], next(iter(v))[1], int(next(iter(v))[2])] for k, v in sorted(roots.items()) if len(v) == 1}}
    write_module(os.path.join(a.out, 'roots.js'), roots_doc, 'roots')
    index_doc = {'schema': 'alef.morph.index/1', 'model': MODEL, 'revision': revision(MODEL), 'units': dict(sorted(index.items())), 'largestUnitBytes': biggest,
                 'counts': dict(sorted(stats.items()))}
    write_module(os.path.join(a.out, 'units.js'), index_doc, 'units')

    os.makedirs(a.review, exist_ok=True)
    json.dump({'schema': 'alef.morph.review/1',
               'note': 'Lesson words where the word list and the model disagree, or where more than one dictionary entry fits. The card shows only what is not in dispute until a person settles each one.',
               'count': len(review), 'byKind': dict(collections.Counter(r['kind'] for r in review)), 'items': review},
              open(os.path.join(a.review, 'lesson-words.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    print(json.dumps(index_doc['counts'], ensure_ascii=False), 'units', len(index), 'largest', biggest, 'review', len(review), 'rootLemmas', len(roots_doc['lemmas']))


if __name__ == '__main__':
    main()
