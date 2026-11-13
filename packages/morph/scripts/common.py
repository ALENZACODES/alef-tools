"""Shared helpers for the offline morphology builds: pinned model loading, Hebrew text helpers, the divine-Name rule."""
import json
import os
import re
import subprocess
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(PKG))

# cantillation and vowel marks (maqaf U+05BE is punctuation and stays)
MARKS = re.compile('[֑-ֽֿ-ׇ]')
HEB = re.compile('[א-ת]')
PREFIX_LETTERS = 'ובכלמשה'

# The four-letter Name, with or without marks, and the common stand-ins. Never analysed, never sent to a model, never
# written to any output: the app shows it as ה׳ (hard rule 5).
_NAME = 'יהוה'
NAME_DISPLAY = 'ה׳'


def strip_marks(s):
    return MARKS.sub('', unicodedata.normalize('NFC', s))


def is_divine_name(word):
    """The same test as src/text.js isNameWord: the Name alone or behind one to three prefix letters, or ה׳ itself."""
    c = ''.join(ch for ch in word if 'א' <= ch <= 'ת')
    if c == _NAME:
        return True
    if c.endswith(_NAME) and re.fullmatch('[ובלמכשה]{1,3}', c[:-len(_NAME)]):
        return True
    return strip_marks(word).strip('.,:;!?()[]') in ('ה׳', "ה'")


def mask_divine_name(text):
    """Replace every form of the Name with ה׳ before anything else sees the text. Returns (text, count)."""
    n = 0
    out = []
    for part in re.split(r'(\s+|־)', text):
        if part and not part.isspace() and part != '־' and is_divine_name(part):
            out.append(NAME_DISPLAY)
            n += 1
        else:
            out.append(part)
    return ''.join(out), n


def scrub(value):
    """Any Python value with every form of the Name replaced by ה׳, for anything that is written to a file."""
    if isinstance(value, str):
        return mask_divine_name(value)[0] if 'יהוה' in strip_marks(value) else value
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    return value


def skeleton(s):
    """A word without the letters that only mark vowels in full spelling (vav, yod). Used ONLY to compare a model lemma,
    which is in full spelling, with a dictionary headword taken from pointed text, which is not."""
    return re.sub('[וי]', '', strip_marks(s))


def plene(words):
    """Pointed words -> full spelling (ktiv male), by the same JS rules the browser uses (src/plene.js). One process per call."""
    if not words:
        return []
    cli = os.path.join(PKG, 'scripts', 'plene_cli.mjs')
    p = subprocess.run(['node', cli], input='\n'.join(words), capture_output=True, text=True, encoding='utf8', check=True)
    out = p.stdout.split('\n')
    if out and out[-1] == '':
        out.pop()
    assert len(out) == len(words), (len(out), len(words))
    return out


def manifest():
    return json.load(open(os.path.join(REPO, 'models.manifest.json'), encoding='utf8'))


def pinned(model_id):
    for m in manifest()['models']:
        if m['id'] == model_id:
            return m
    raise KeyError(model_id)


def load_tokenizer(model_id, revision):
    """The model's OWN tokenizer, read from its tokenizer.json.
    Do not use AutoTokenizer here: recent transformers releases rebuild a plain BERT tokenizer for these repos and drop
    the model's custom word splitter, so acronyms and abbreviations (מו"מ, פרופ') come out as three tokens where the
    model was trained on one. The browser tokenizer (src/tokenize.js) follows tokenizer.json too."""
    from huggingface_hub import hf_hub_download
    from transformers import PreTrainedTokenizerFast
    path = hf_hub_download(model_id, 'tokenizer.json', revision=revision)
    return PreTrainedTokenizerFast(tokenizer_file=path, unk_token='[UNK]', cls_token='[CLS]', sep_token='[SEP]', pad_token='[PAD]', mask_token='[MASK]')


CODE_REPO = 'dicta-il/dictabert-joint'  # the joint and parse models take their model code from this repo


def revision(model_id):
    """The pinned Hub commit of a model (models.manifest.json, `hubRevision`)."""
    return pinned(model_id)['hubRevision']


def load_joint(model_id):
    """A DictaBERT joint/parse model at its pinned revision, with the model code pinned too."""
    from transformers import AutoModel
    tok = load_tokenizer(model_id, revision(model_id))
    model = AutoModel.from_pretrained(model_id, revision=revision(model_id), code_revision=revision(CODE_REPO), trust_remote_code=True).eval()
    return model, tok


def write_module(path, value, note):
    """Writes built data as a one-line ES module (`export default {...};`). The app's offline list takes the tools
    folder's .js files, and a screen loads a unit with import(); the JSON inside is unchanged."""
    raw = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    assert '\u2028' not in raw and '\u2029' not in raw and '\n' not in raw
    text = f'export default {raw};\n'
    with open(path, 'w', encoding='utf8', newline='\n') as f:
        f.write(text)
    return len(text.encode('utf8'))


def predict(model, tok, sentences, budget=1200, per_token_ner=False):
    """model.predict in batches. The lemma head returns 128000 numbers per token, so a batch is sized by letters, not
    by sentence count: 32 long prayer passages in one batch need more memory than the machine has."""
    import torch
    order = sorted(range(len(sentences)), key=lambda i: len(sentences[i]))
    out = [None] * len(sentences)
    i = 0
    while i < len(order):
        n = 1  # rough tokens per text: a third of its letters (a Hebrew word is about four letters and a space)
        while i + n < len(order) and n < 48 and max(8, len(sentences[order[i + n]]) // 3) * (n + 1) <= budget:
            n += 1
        idx = order[i:i + n]
        with torch.no_grad():
            res = model.predict([sentences[k] for k in idx], tok, output_style='json', per_token_ner=per_token_ner)
        for k, r in zip(idx, res):
            out[k] = r
        i += n
    return out


POS_OK = {
    'noun': {'NOUN', 'PROPN'}, 'verb': {'VERB', 'AUX'}, 'adj': {'ADJ'}, 'adv': {'ADV'}, 'prep': {'ADP'}, 'pron': {'PRON'},
    'conj': {'CCONJ', 'SCONJ'}, 'num': {'NUM'}, 'intj': {'INTJ'}, 'det': {'DET'},
}


class WordList:
    """The app's own word list (data/vocab/words.json) as a lookup: which dictionary entry is this word?

    A word is linked to an entry only when one entry fits. Evidence, strongest first:
      exact   the word as shown, points and all, is exactly one entry's headword or listed form
      form    its letters (without prefixes) are a listed form of the entry, and the model's part of speech allows it
      lemma   the model's lemma is the entry's headword (or its present form, the model's name for a verb)
    Two entries that fit equally well give no link: the choice goes to the review list, not to the learner."""

    FORM_KINDS = ('plural', 'feminine', 'present', 'future', 'infinitive')

    def __init__(self, app):
        words = json.load(open(os.path.join(app, 'data/vocab/words.json'), encoding='utf8'))['words']
        self.entries = [w for w in words if w.get('kind') == 'word' and ' ' not in w['he'] and not (w.get('flags') or {}).get('hidden')]
        self.by_id = {w['id']: w for w in self.entries}
        try:
            self.verified_roots = set(json.load(open(os.path.join(app, 'data/roots/verified.json'), encoding='utf8')).get('roots') or [])
        except OSError:
            self.verified_roots = set()
        pointed = []
        for w in self.entries:
            pointed.append((w, 'head', w['he']))
            for k in self.FORM_KINDS:
                f = (w.get('forms') or {}).get(k)
                if isinstance(f, str) and ' ' not in f:
                    pointed.append((w, k, f))
        full = plene([f for _, _, f in pointed])
        self.by_pointed, self.by_form = {}, {}
        for (w, kind, f), fl in zip(pointed, full):
            self.by_pointed.setdefault(unicodedata.normalize('NFC', f), []).append((w['id'], kind))
            for key in {strip_marks(f), fl}:
                self.by_form.setdefault(key, []).append((w['id'], kind))

    def link(self, shown, key, tok):
        """-> (entry id or None, how, candidates considered). `tok` is the model's answer for the word."""
        prefix = tok['seg'][0] if len(tok['seg']) > 1 else ''
        base = tok['seg'][-1]
        lemma = tok['lex'] if tok['lex'] != '[BLANK]' else None
        pos = tok['morph']['pos']
        def fits(wid):
            return self.by_id[wid]['pos'] not in POS_OK or pos in POS_OK[self.by_id[wid]['pos']]

        exact = sorted({wid for wid, _ in self.by_pointed.get(unicodedata.normalize('NFC', shown), [])})
        if len(exact) == 1:
            return exact[0], 'exact', exact
        form = {wid for k in {base, key[len(prefix):] if prefix else key} for wid, _ in self.by_form.get(k, [])}
        if exact:
            form &= set(exact) or form
        by_lemma = {wid for wid, kind in self.by_form.get(lemma, []) if kind in ('head', 'present')} if lemma else set()
        both = {w for w in form & by_lemma if fits(w)}
        if len(both) == 1:
            return next(iter(both)), 'form+lemma', sorted(form | by_lemma)
        form_ok = {w for w in form if fits(w)}
        if not both and len(form_ok) == 1:
            return next(iter(form_ok)), 'form', sorted(form | by_lemma)
        lemma_ok = {w for w in by_lemma if fits(w)}
        if not both and not form_ok and len(lemma_ok) == 1:
            return next(iter(lemma_ok)), 'lemma', sorted(form | by_lemma)
        return None, 'unclear' if (form or by_lemma) else 'none', sorted(form | by_lemma)

    def card(self, wid):
        """What the tap card may show from the list for a linked entry."""
        w = self.by_id[wid]
        root = w.get('root')
        return {'he': w['he'], 'en': w['en'], 'pos': w['pos'], 'gender': w.get('gender'), 'root': root, 'binyan': w.get('binyan'),
                'rootChecked': bool(root and root in self.verified_roots)}
