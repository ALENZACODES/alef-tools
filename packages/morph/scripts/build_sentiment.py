#!/usr/bin/env python3
"""Label sentences for feelings games with dicta-il/dictabert-sentiment, for a person to check.

  python build_sentiment.py --app <Al-Heb> --review ../review/sentiment.json --out ../src/data/sentiment/games.js

Sentences come from the app's own data only: the example sentences of word-list entries in the feelings topic
(data/vocab/words.json, topic "feelings-mind"; everyday sentences from Tatoeba, with their English and attribution)
and every line of the course dialogues (data/curriculum/dialogues.json). Nothing is written or generated here.

Two files:
  review/sentiment.json        EVERY sentence with the model's label and its three scores, and `checked: false`.
                               A reviewer sets `checked: true` (and corrects `label` if needed) per item. Running this
                               script again keeps those decisions: an item is matched by its id and its Hebrew text.
  src/data/sentiment/games.js  only the items a person marked `checked: true` (an ES module, copied to dist/).
                               This is the file the app may ship.
                               Until someone reviews, it is an empty list, on purpose.
Verse examples are left out (a mood label on scripture is not something a model should suggest), and so is any
sentence with the divine Name.
"""
import argparse
import json
import os

from common import is_divine_name, plene, revision, strip_marks, write_module

MODEL = 'dicta-il/dictabert-sentiment'


def collect(app):
    items = []
    words = json.load(open(os.path.join(app, 'data/vocab/words.json'), encoding='utf8'))['words']
    for w in words:
        ex = w.get('example') or {}
        src = ex.get('source') or {}
        if w.get('topic') != 'feelings-mind' or not ex.get('he') or src.get('type') != 'tatoeba':
            continue
        items.append({'id': f"vocab:{w['id']}", 'he': ex['he'], 'en': ex.get('en'), 'word': w['he'],
                      'source': {'file': 'data/vocab/words.json', 'entry': w['id'], 'license': src.get('license'), 'url': src.get('url'), 'heAuthor': src.get('heAuthor'), 'enAuthor': src.get('enAuthor')}})
    for d in json.load(open(os.path.join(app, 'data/curriculum/dialogues.json'), encoding='utf8'))['dialogues']:
        for line in d['lines']:
            items.append({'id': f"dialogue:{line['id']}", 'he': line['he'], 'en': line.get('en'), 'source': {'file': 'data/curriculum/dialogues.json', 'dialogue': d['id']}})
    return [i for i in items if not any(is_divine_name(x) for x in i['he'].split())]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', required=True)
    ap.add_argument('--review', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    import torch
    from transformers import AutoModelForSequenceClassification
    from common import load_tokenizer
    rev = revision(MODEL)
    tok = load_tokenizer(MODEL, rev)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL, revision=rev).eval()
    labels = [model.config.id2label[i].lower() for i in range(model.config.num_labels)]
    items = collect(a.app)
    old = {}
    if os.path.exists(a.review):
        old = {(i['id'], i['he']): i for i in json.load(open(a.review, encoding='utf8'))['items']}
    for i in range(0, len(items), 32):
        batch = items[i:i + 32]
        enc = tok([strip_marks(t) for t in plene([x['he'] for x in batch])], padding=True, truncation=True, return_tensors='pt')
        enc.pop('token_type_ids', None)
        with torch.no_grad():
            probs = torch.softmax(model(**enc).logits, -1).tolist()
        for x, p in zip(batch, probs):
            best = max(range(len(p)), key=p.__getitem__)
            x['model'] = {'label': labels[best], 'scores': {name: round(v, 3) for name, v in zip(labels, p)}}
            prev = old.get((x['id'], x['he']))
            x['label'] = prev['label'] if prev and prev.get('checked') else labels[best]
            x['checked'] = bool(prev and prev.get('checked'))
    os.makedirs(os.path.dirname(a.review), exist_ok=True)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    counts = {name: sum(1 for x in items if x['model']['label'] == name) for name in labels}
    json.dump({'schema': 'alef.sentiment.review/1', 'model': MODEL, 'revision': rev,
               'howToReview': 'For each item read the Hebrew and the English, fix `label` if the model is wrong (positive, neutral or negative), then set `checked` to true. Leave an item unchecked to keep it out of the app.',
               'count': len(items), 'checked': sum(1 for x in items if x['checked']), 'modelLabels': counts, 'items': items},
              open(a.review, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    shipped = [{k: x[k] for k in ('id', 'he', 'en', 'label', 'source')} for x in items if x['checked']]
    write_module(a.out, {'schema': 'alef.sentiment.games/1', 'note': 'Only sentences a person has checked. Built by packages/morph/scripts/build_sentiment.py.', 'count': len(shipped), 'items': shipped}, 'games')
    print(json.dumps({'sentences': len(items), 'checked': len(shipped), 'modelLabels': counts}))


if __name__ == '__main__':
    main()
