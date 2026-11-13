#!/usr/bin/env python3
# ruff: noqa: E401, E701, E702, E731, E741
"""Builds the translation memory: Hebrew sentences of the app with an English line each, ready before the learner asks.

  python3 scripts/build-tm.py --app <app checkout> --out <dir> --review <dir>
                              [--hq <opus-mt-tc-big-he-en snapshot> --back <opus-mt-en-he snapshot>] [--cache <file>] [--limit N]

Where the English comes from
  app   the sentence already has English in the app's own data: that wording is used as it is.
  pack  the sentence has none: it is translated here, offline, by the high-quality Hebrew to English model (--hq),
        then translated back by the English to Hebrew model (--back). Without --hq these sentences are only counted.

What may ship (scripts/tm_gates.py)
  A line that holds the four-letter Name is held: never translated, never stored.
  Scripture, prayer and cited source lines are never machine translated, and are left out of the memory altogether.
  Sentences that came from an outside collection (the Tatoeba examples of the vocabulary) are left out: they need a credit each.
  Every entry must pass the rule checks (shape, numbers, person, singular and plural). A machine-made entry must also pass
  the round trip and agree with a second model (scripts/tm-agree.mjs). An entry that fails goes to <review>/tm-needs-human.json with the reason, and not into the app.

What is written
  <out>/index.json        the units, and for each the hashes of its keys, so the app fetches a unit only when a line is in it
  <out>/<unit>.json       at most 300 KiB each: [[key, english, "a"|"p"], ...]
  <review>/tm-needs-human.json    every entry that failed, with the reasons, for a person to settle
  <review>/tm-report.json         the counts of this build
Needs scripts/requirements.txt only with --hq. Build-time only; nothing here runs on the learner's device.
"""
import argparse, base64, hashlib, json, os, re, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tm_gates as G

UNIT_LIMIT = 300 * 1024
UNIT_TARGET = 240 * 1024
# Areas of the app's data folder that hold everyday sentences, in order of whose wording wins when a sentence appears twice.
AREAS = ['curriculum', 'books', 'israel', 'corpus', 'games']
# Left out on purpose: vocab, speak and pronunciation. Their example sentences come from Tatoeba (CC BY 2.0 FR), which asks for a credit
# on every sentence; a memory answer has no place to show one. A record elsewhere that names such a source is skipped too.
THIRD_PARTY = re.compile(r'tatoeba|vocab|wiktionary|kaikki|opensubtitles', re.I)
HE_FIELDS = ('he', 'm', 'f')
EN_FIELDS = ('en', 'english')
MIN_WORDS, MAX_WORDS = 3, 30


def collect(app):
    """Every Hebrew sentence of the chosen areas: [{key, he, en|None, area, file, sacred}] in priority order, first wording kept."""
    seen, out, counts = {}, [], {'records': 0, 'held': 0, 'sacred': 0, 'duplicates': 0, 'conflicts': 0}

    def take(he, en, area, path, record):
        key = G.tm_key(he)
        n = len(G.he_words(key))
        if n < MIN_WORDS or n > MAX_WORDS or len(he) > 400 or re.search(r'[A-Za-z]{2}', key): return
        counts['records'] += 1
        if any(isinstance(record.get(k), str) and THIRD_PARTY.search(record[k]) for k in ('source', 'src', 'attribution', 'license', 'licence')): counts['thirdParty'] = counts.get('thirdParty', 0) + 1; return
        if re.search(r'[\u05D0-\u05EA][-\u05BE\u2013]\d', he): counts['skipped'] = counts.get('skipped', 0) + 1; return   # a prefix joined to a number (לכ-20): the key would split it
        if G.holds_name(he) or (en and G.holds_name(en)): counts['held'] += 1; return
        if G.is_sacred(he, path, record): counts['sacred'] += 1; return
        en = re.sub(r'\s+', ' ', en).strip() if isinstance(en, str) and re.search(r'[A-Za-z]{2}', en) and not G.HE.search(en) else None
        if key in seen:
            counts['duplicates'] += 1
            old = seen[key]
            if en and not old['en']: old.update(en=en, area=area, file=path)       # a later copy brings the app's own English
            elif en and old['en'] and G.tm_key(en) != G.tm_key(old['en']): counts['conflicts'] += 1
            return
        seen[key] = {'key': key, 'he': he, 'en': en, 'area': area, 'file': path}
        out.append(seen[key])

    def walk(o, area, path):
        if isinstance(o, dict):
            en = next((o[k] for k in EN_FIELDS if isinstance(o.get(k), str)), None)
            for f in HE_FIELDS:
                v = o.get(f)
                if isinstance(v, str) and G.HE.search(v): take(v, en, area, path, o)
            for v in o.values(): walk(v, area, path)
        elif isinstance(o, list):
            for v in o: walk(v, area, path)

    for area in AREAS:
        base = os.path.join(app, 'data', area)
        for root, dirs, files in os.walk(base):
            dirs.sort()
            for name in sorted(files):
                full = os.path.join(root, name); rel = os.path.relpath(full, os.path.join(app, 'data')).replace(os.sep, '/')
                if not name.endswith('.json') or os.path.getsize(full) > 6_000_000 or any(p in rel for p in G.SACRED_PATHS): continue
                try: walk(json.load(open(full, encoding='utf8')), area, rel)
                except (ValueError, OSError): continue
    return out, counts


def translate(model_dir, lines, batch=12, beams=4, note=''):
    import torch
    from transformers import MarianMTModel, MarianTokenizer
    tok = MarianTokenizer.from_pretrained(model_dir); m = MarianMTModel.from_pretrained(model_dir).float().eval()
    out = []
    with torch.no_grad():
        for i in range(0, len(lines), batch):
            enc = tok(lines[i:i + batch], return_tensors='pt', padding=True, truncation=True, max_length=128)
            gen = m.generate(**enc, num_beams=beams, max_new_tokens=128)
            out += [tok.decode(g, skip_special_tokens=True) for g in gen]
            if (i // batch) % 10 == 0: print(f'  {note} {min(i + batch, len(lines))}/{len(lines)}', flush=True)
    return out


def write_units(entries, out_dir):
    """Units of at most UNIT_TARGET bytes, named after the area. Returns the index."""
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith('.json'): os.remove(os.path.join(out_dir, f))
    units, by_area = [], {}
    for e in entries: by_area.setdefault(e['area'], []).append(e)
    for area in AREAS:
        rows = sorted(by_area.get(area, []), key=lambda e: e['key'])
        shards, cur, size = [], [], 0
        for e in rows:
            row = [e['key'], e['en'], e['src']]
            b = len(json.dumps(row, ensure_ascii=False).encode('utf8')) + 2
            if cur and size + b > UNIT_TARGET: shards.append(cur); cur, size = [], 0
            cur.append(row); size += b
        if cur: shards.append(cur)
        for i, shard in enumerate(shards):
            uid = area if len(shards) == 1 else f'{area}-{i + 1}'
            body = json.dumps({'schema': 'alef.translate.tm.unit.v1', 'unit': uid, 'entries': shard}, ensure_ascii=False, separators=(',', ':')).encode('utf8') + b'\n'
            assert len(body) <= UNIT_LIMIT, f'{uid} is {len(body)} bytes'
            open(os.path.join(out_dir, uid + '.json'), 'wb').write(body)
            hashes = sorted({G.fnv1a(r[0]) for r in shard})
            units.append({'id': uid, 'file': uid + '.json', 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest(), 'entries': len(shard),
                          'hashes': base64.b64encode(struct.pack(f'<{len(hashes)}I', *hashes)).decode('ascii')})
    index = {'schema': 'alef.translate.tm.index.v1', 'note': 'Hebrew sentences of the app with an English line each. src a = the app\'s own English; p = translated ahead of time by the high-quality language pack and passed by the checks in alef-tools packages/translate/scripts/tm_gates.py.',
             'entries': sum(u['entries'] for u in units), 'units': units}
    open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf8').write(json.dumps(index, ensure_ascii=False, separators=(',', ':')) + '\n')
    return index


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', required=True); ap.add_argument('--out', required=True); ap.add_argument('--review', required=True)
    ap.add_argument('--hq'); ap.add_argument('--back'); ap.add_argument('--cache'); ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    talk = json.load(open(os.path.join(a.app, 'data', 'talk', 'pack.json'), encoding='utf8'))
    forms, nouns = G.number_forms(talk.get('numbers')), G.noun_table(talk.get('nouns'))
    records, counts = collect(a.app)
    cache = json.load(open(a.cache, encoding='utf8')) if a.cache and os.path.exists(a.cache) else {}
    todo = [r for r in records if not r['en']]
    if a.limit: todo = todo[:a.limit]
    if a.hq:
        need = [r for r in todo if r['key'] not in cache]
        print(f'{len(todo)} sentences without English; translating {len(need)}', flush=True)
        if need:
            en = translate(a.hq, [r['key'] for r in need], note='to English')
            back = translate(a.back, en, note='back to Hebrew') if a.back else [''] * len(en)
            for r, e, b in zip(need, en, back): cache[r['key']] = {'en': e, 'back': b}
            if a.cache: json.dump(cache, open(a.cache, 'w', encoding='utf8'), ensure_ascii=False, indent=0)
    keep, review = [], []
    for r in records:
        if r['en']:
            why = G.rule_checks(r['key'], r['en'], forms, nouns)
            if why: review.append({'kind': 'app-pair', 'he': r['he'], 'english': r['en'], 'file': 'data/' + r['file'], 'why': why})
            else: keep.append({**r, 'src': 'a'})
            continue
        c = cache.get(r['key'])
        if not c: counts['untranslated'] = counts.get('untranslated', 0) + 1; continue
        why = G.rule_checks(r['key'], c['en'], forms, nouns)
        stuck = G.check_machine_shape(c['en'])
        if stuck: why.append(stuck)
        if a.back or c.get('back'):
            bad, score = G.check_round_trip(r['key'], c.get('back', ''))
            if bad: why.append(bad)
        else: why.append('no round trip was run'); score = None
        if 'second' in c:
            bad, agree = G.check_agreement(c['en'], c['second'])
            if bad: why.append(bad)
        else: why.append('no second opinion was run (scripts/tm-agree.mjs)'); agree = None
        if why: review.append({'kind': 'machine', 'he': r['he'], 'english': c['en'], 'back': c.get('back', ''), 'roundTrip': None if score is None else round(score, 1), 'second': c.get('second', ''), 'agreement': None if agree is None else round(agree, 1), 'file': 'data/' + r['file'], 'why': why})
        else: keep.append({**r, 'en': c['en'], 'src': 'p'})
    index = write_units(keep, a.out)
    os.makedirs(a.review, exist_ok=True)
    json.dump({'schema': 'alef.translate.tm.review.v1', 'note': 'Entries the checks turned down. None of them is in the app. kind machine: translated offline, failed a check. kind app-pair: the app\'s own English failed a rule check (often a free wording; sometimes a slip worth a look). For a person to settle.',
               'entries': review}, open(os.path.join(a.review, 'tm-needs-human.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    report = {'schema': 'alef.translate.tm.report.v1', **counts, 'unique': len(records), 'withAppEnglish': sum(1 for r in records if r['en']), 'withoutEnglish': sum(1 for r in records if not r['en']),
              'kept': len(keep), 'keptApp': sum(1 for e in keep if e['src'] == 'a'), 'keptMachine': sum(1 for e in keep if e['src'] == 'p'),
              'review': len(review), 'reviewMachine': sum(1 for e in review if e['kind'] == 'machine'), 'reviewAppPair': sum(1 for e in review if e['kind'] == 'app-pair'),
              'units': [{'id': u['id'], 'bytes': u['bytes'], 'entries': u['entries']} for u in index['units']], 'largestUnitBytes': max([u['bytes'] for u in index['units']] or [0]),
              'indexBytes': os.path.getsize(os.path.join(a.out, 'index.json'))}
    json.dump(report, open(os.path.join(a.review, 'tm-report.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != 'units'}))


if __name__ == '__main__':
    main()
