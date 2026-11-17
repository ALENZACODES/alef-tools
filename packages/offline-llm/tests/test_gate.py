"""The gate, checked against a tiny stand-in for an Al-Heb checkout (tests/fixtures/app). Standard library only.

    python -m unittest discover -s tests -p "test_*.py"
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
import common  # noqa: E402
import gate  # noqa: E402
import gen_ask  # noqa: E402
import gen_examples  # noqa: E402
import judge  # noqa: E402

APP = HERE / "fixtures" / "app"
NAME = "יְהוָה"
GEN = {"key": "gen-1.7b", "id": "dicta-il/DictaLM-3.0-1.7B-Instruct"}
J1 = {"key": "j1", "id": "dicta-il/DictaLM-3.0-1.7B-Thinking-GGUF", "ok": True}
J2 = {"key": "j2", "id": "dicta-il/dictalm2.0-instruct-GGUF", "ok": True}
OK = {"ok": True}
Q = {"j1", "j2"}  # judges that qualified on the known-answer set


def example(**over):
    row = {"id": "ex-1", "type": "example", "unit": "pu-test", "level": "L0", "target": {"itemId": "t-01", "he": "קָפֶה", "en": "coffee"},
           "he": "אני רוצה קפה עם חלב", "en": "I want coffee with milk", "generator": GEN, "judges": [dict(J1), dict(J2)],
           "checks": {"morph": dict(OK), "roundtrip": dict(OK), "offensive": dict(OK)}}
    row.update(over)
    return row


class Examples(unittest.TestCase):
    def setUp(self):
        self.app = common.App(APP)

    def fails(self, row):
        return gate.check_example(row, self.app, set(), Q)

    def test_clean_item_passes(self):
        self.assertEqual(self.fails(example()), [])

    def test_one_judge_is_not_enough(self):
        self.assertTrue(any(f.startswith("judges") for f in self.fails(example(judges=[dict(J1)]))))

    def test_same_judge_twice_is_not_two_judges(self):
        self.assertTrue(any(f.startswith("judges") for f in self.fails(example(judges=[dict(J1), dict(J1)]))))

    def test_generator_cannot_judge_itself(self):
        self.assertTrue(any("generator" in f for f in gate.check_example(example(judges=[dict(J1), {**GEN, "ok": True}]), self.app, set(), Q | {GEN["key"]})))

    def test_a_judge_that_did_not_qualify_does_not_count(self):
        fails = gate.check_example(example(), self.app, set(), {"j1"})
        self.assertTrue(any(f.startswith("judges: 1 qualified") for f in fails), fails)
        self.assertTrue(any(f.startswith("judges: 0 qualified") for f in gate.check_example(example(), self.app, set(), set())))

    def test_a_judge_saying_no_sends_to_review(self):
        self.assertTrue(any(f.startswith("judges") for f in self.fails(example(judges=[dict(J1), {**J2, "ok": False, "reason": "unnatural"}]))))

    def test_missing_model_check_counts_as_failed(self):
        for name in ("morph", "roundtrip", "offensive"):
            row = example()
            del row["checks"][name]
            self.assertTrue(any(f.startswith(name + ": not run") for f in self.fails(row)), name)

    def test_failed_model_check_sends_to_review(self):
        row = example()
        row["checks"]["offensive"] = {"ok": False, "detail": "flagged"}
        self.assertTrue(any(f.startswith("offensive") for f in self.fails(row)))

    def test_word_above_level_sends_to_review(self):
        fails = self.fails(example(he="אני רוצה קפה במסעדה", en="I want coffee at the restaurant"))  # the restaurant word is tier 1000, the unit is L0
        self.assertTrue(any(f.startswith("level") for f in fails), fails)

    def test_prefixed_and_inflected_known_words_are_in_level(self):
        self.assertEqual(self.fails(example(he="אני רוצה קפה וחלב", en="I want coffee and milk")), [])
        row = example(he="הילדה רוצה מים קרים", en="The girl wants cold water", target={"itemId": "t-02", "he": "מַיִם", "en": "water"})
        self.assertEqual(self.fails(row), [])

    def test_lemma_from_morph_counts_for_level(self):
        row = example(he="אני שותים קפה", en="x")
        self.assertTrue(any(f.startswith("level") for f in self.fails(row)))
        row["checks"]["morph"]["lemmas"] = {common.he_key("שותים"): "שותה"}
        self.assertFalse(any(f.startswith("level") for f in self.fails(row)))

    def test_duplicate_of_app_sentence(self):
        fails = self.fails(example(he="אֲנִי רוֹצֶה קָפֶה!", en="I would like a coffee"))
        self.assertTrue(any(f.startswith("duplicate") for f in fails), fails)
        fails = self.fails(example(he="אני שותה מים", en="I drink water"))  # a dictionary example in the app
        self.assertTrue(any(f.startswith("duplicate") for f in fails), fails)

    def test_duplicate_of_earlier_candidate(self):
        seen = set()
        self.assertEqual(gate.check_example(example(), self.app, seen, Q), [])
        self.assertTrue(any(f.startswith("duplicate") for f in gate.check_example(example(id="ex-2"), self.app, seen, Q)))

    def test_name_spelled_out_is_refused(self):
        self.assertTrue(any(f.startswith("name") for f in self.fails(example(he="אני רוצה קפה " + NAME))))
        self.assertTrue(any(f.startswith("name") for f in self.fails(example(he="אני רוצה קפה יהוה"))))

    def test_wording_about_machines_is_refused(self):
        for en in ("As an AI I want coffee", "This sentence was generated by a language model", "machine-translated: I want coffee"):
            self.assertTrue(any(f.startswith("wording") for f in self.fails(example(en=en))), en)
        self.assertEqual(self.fails(example(en="I said I want coffee with milk again")), [])  # 'said', 'again' contain "ai" but are fine


class Ask(unittest.TestCase):
    def setUp(self):
        self.app = common.App(APP)

    def row(self, question="What was created in the beginning?", verse="genesis.1.1", span="בָּרָא אֱלֹהִים", **over):
        v = self.app.verse(verse)
        row = {"id": "an-1", "type": "ask", "question": question, "question_he": "מה נברא בראשית?", "hits": [{"verse_id": verse, "span": span}],
               "answer": gen_ask.assemble(question, [{"verse": v, "span": span}]), "judges": [dict(J1), dict(J2)], "retriever": {"id": "x"}}
        row.update(over)
        return row

    def test_quote_and_cite_passes(self):
        self.assertEqual(gate.check_ask(self.row(), self.app, Q), [])

    def test_no_citation_is_refused(self):
        row = self.row()
        row["answer"]["passages"] = []
        self.assertTrue(any(f.startswith("cite") for f in gate.check_ask(row, self.app, Q)))

    def test_citation_must_be_a_source_in_the_app(self):
        row = self.row()
        row["answer"]["passages"][0]["id"] = "genesis.40.1"
        self.assertTrue(any("not a source in the app" in f for f in gate.check_ask(row, self.app, Q)))

    def test_quote_must_match_the_source_exactly(self):
        row = self.row()
        row["answer"]["passages"][0]["quote"] = "ברא אלהים"  # same words without the points: not the exact text
        self.assertTrue(any(f.startswith("quote") for f in gate.check_ask(row, self.app, Q)))
        row = self.row()
        row["answer"]["passages"][0]["quote"] = ""
        self.assertTrue(any(f.startswith("quote") for f in gate.check_ask(row, self.app, Q)))
        row = self.row()
        row["answer"]["passages"][0]["he"] = row["answer"]["passages"][0]["he"].replace("בָּרָא", "ברא")
        self.assertTrue(any("not the app's text" in f for f in gate.check_ask(row, self.app, Q)))

    def test_the_name_is_shown_only_in_short_form(self):
        row = self.row(verse="genesis.2.4", span="אֶרֶץ וְשָׁמָיִם")
        passage = row["answer"]["passages"][0]
        self.assertIn(common.NAME_SHOWN, passage["he"])
        self.assertFalse(common.name_spelled(passage["he"]))
        self.assertEqual(gate.check_ask(row, self.app, Q), [])
        passage["he"] = self.app.verse("genesis.2.4")["he"]  # the raw source text spells the Name
        self.assertTrue(any(f.startswith("name") for f in gate.check_ask(row, self.app, Q)))

    def test_a_ruling_is_reported_not_given(self):
        row = self.row(question="Can I light a fire on Shabbat?")
        ans = row["answer"]
        self.assertTrue(ans["explanation"].startswith("Sources say"))
        self.assertIn("ask your rabbi", ans["explanation"])
        self.assertEqual(gate.check_ask(row, self.app, Q), [])
        ans["explanation"] = "Yes, you may."
        self.assertTrue(any(f.startswith("ruling") for f in gate.check_ask(row, self.app, Q)))

    def test_needs_two_judges(self):
        self.assertTrue(any(f.startswith("judges") for f in gate.check_ask(self.row(judges=[dict(J1)]), self.app, Q)))

    def test_locate_maps_an_unpointed_span_to_the_exact_text(self):
        v = self.app.verse("genesis.1.1")
        self.assertEqual(gen_ask.locate("ברא אלהים", v["he"]), "בָּרָא אֱלֹהִים")
        self.assertIsNone(gen_ask.locate("ברא משה", v["he"]))

    def test_hebrew_wording_must_point_at_a_checked_answer(self):
        row = {"id": "aw-1", "answerId": "aa11", "he": "איפה התורה מדברת על שבת?", "generator": GEN, "judges": [dict(J1), dict(J2)], "checks": {"offensive": dict(OK)}}
        self.assertEqual(gate.check_wording(row, {"aa11"}, Q), [])
        self.assertTrue(any(f.startswith("cite") for f in gate.check_wording({**row, "answerId": "zz"}, {"aa11"}, Q)))
        self.assertTrue(any(f.startswith("offensive") for f in gate.check_wording({**row, "checks": {}}, {"aa11"}, Q)))


class Quiz(unittest.TestCase):
    def setUp(self):
        self.app = common.App(APP)

    def line(self, **over):
        row = {"id": "qz-1", "type": "quiz", "source": "line", "lineId": "line-1", "unit": "prayer-torah", "wordIndex": 1,
               "stem": "בְּרֵאשִׁית ___ אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃", "choices": ["אמר", "ברא", "ראה", "עשה"], "answer": 1, "en": "In the beginning God created the heaven and the earth.",
               "judges": [{**J1, "answer": 1, "unique": True}, {**J2, "answer": 1, "unique": True}], "checks": {"cloze": dict(OK)}}
        row.update(over)
        return row

    def test_line_item_passes(self):
        self.assertEqual(gate.check_quiz(self.line(), set(), self.app, Q), [])

    def test_stem_must_be_the_apps_text(self):
        self.assertTrue(any(f.startswith("source") for f in gate.check_quiz(self.line(stem="בראשית ___ אלהים את השמים ואת הארץ"), set(), self.app, Q)))

    def test_keyed_answer_must_be_the_blanked_word(self):
        self.assertTrue(any(f.startswith("source") for f in gate.check_quiz(self.line(answer=0, judges=[{**J1, "answer": 0, "unique": True}, {**J2, "answer": 0, "unique": True}]), set(), self.app, Q)))

    def test_judges_must_both_pick_the_key_and_call_it_unique(self):
        row = self.line(judges=[{**J1, "answer": 1, "unique": True}, {**J2, "answer": 2, "unique": True}])
        self.assertTrue(any(f.startswith("judges") for f in gate.check_quiz(row, set(), self.app, Q)))
        row = self.line(judges=[{**J1, "answer": 1, "unique": True}, {**J2, "answer": 1, "unique": False}])
        self.assertTrue(any(f.startswith("judges") for f in gate.check_quiz(row, set(), self.app, Q)))

    def test_example_item_needs_its_example_to_have_shipped(self):
        row = {"id": "qz-2", "type": "quiz", "source": "example", "exampleId": "ex-1", "unit": "pu-test", "stem": "אני רוצה ___ עם חלב", "choices": ["מים", "קפה", "לחם", "חלב"],
               "answer": 1, "en": "I want coffee with milk", "judges": [{**J1, "answer": 1, "unique": True}, {**J2, "answer": 1, "unique": True}]}
        self.assertEqual(gate.check_quiz(row, {"ex-1"}, self.app, Q), [])
        self.assertTrue(any(f.startswith("source") for f in gate.check_quiz(row, set(), self.app, Q)))

    def test_duplicate_choices_are_refused(self):
        self.assertTrue(any(f.startswith("choices") for f in gate.check_quiz(self.line(choices=["ברא", "ברא", "ראה", "עשה"]), set(), self.app, Q)))


class Run(unittest.TestCase):
    def test_only_passed_items_reach_dist_and_all_are_marked_checked(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            good, bad = example(), example(id="ex-2", he="אני רוצה קפה במסעדה", en="I want coffee at the restaurant")
            common.write_jsonl(tmp / "work" / "examples.jsonl", [good, bad])
            common.write_json(tmp / "work" / "judges.json", {"j1": {"qualified": True}, "j2": {"qualified": True}})
            rep = gate.run(APP, tmp / "work", tmp, 1)
            self.assertEqual(rep["counts"]["examples"], {"generated": 2, "passed_gate": 1, "sent_to_review": 1, "review_reasons": {"level": 1}})
            shipped = json.loads((tmp / "src" / "examples" / "pu-test.json").read_text(encoding="utf-8"))
            self.assertEqual([i["id"] for i in shipped["items"]], ["ex-1"])
            self.assertTrue(all(i["checked"] is True for i in shipped["items"]))
            review = json.loads((tmp / "review" / "examples.json").read_text(encoding="utf-8"))
            self.assertEqual([i["id"] for i in review["items"]], ["ex-2"])
            self.assertNotIn("checked\": false", (tmp / "src" / "examples" / "pu-test.json").read_text(encoding="utf-8"))


    def test_without_a_qualification_record_nothing_ships(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            common.write_jsonl(tmp / "work" / "examples.jsonl", [example()])
            rep = gate.run(APP, tmp / "work", tmp, 1)
            self.assertEqual(rep["counts"]["examples"]["passed_gate"], 0)
            self.assertFalse((tmp / "src" / "examples").exists())


class Helpers(unittest.TestCase):
    def test_judge_qualification(self):
        can = [{"good": True, "judges": [{"key": "a", "ok": True}, {"key": "b", "ok": True}]} for _ in range(6)] + \
              [{"good": False, "judges": [{"key": "a", "ok": False}, {"key": "b", "ok": True}]} for _ in range(8)]
        self.assertTrue(judge.qualification(can, "a")["qualified"])
        self.assertFalse(judge.qualification(can, "b")["qualified"])  # says yes to everything
        self.assertFalse(judge.qualification(can, "c")["qualified"])  # never answered

    def test_hebrew_key(self):
        self.assertEqual(common.he_key("שָׁלוֹם, עוֹלָם!"), common.he_key("שלום עולם"))
        self.assertEqual(common.he_key("עַל־לְבָבֶךָ"), "על לבבכ")

    def test_show_name(self):
        self.assertEqual(common.show_name("יְבָרֶכְךָ " + NAME + " וְיִשְׁמְרֶךָ"), "יְבָרֶכְךָ " + common.NAME_SHOWN + " וְיִשְׁמְרֶךָ")
        self.assertFalse(common.name_spelled(common.NAME_SHOWN))

    def test_prefilter(self):
        self.assertIsNone(gen_examples.prefilter("אני רוצה קפה עם חלב", "I want coffee with milk", "קָפֶה"))
        self.assertEqual(gen_examples.prefilter("אני רוצה תה עם חלב", "x", "קָפֶה"), "target-missing")
        self.assertEqual(gen_examples.prefilter("קפה טוב", "x", "קָפֶה"), "length")
        self.assertEqual(gen_examples.prefilter("I want קפה now please", "x", "קָפֶה"), "not-hebrew")
        self.assertIsNone(gen_examples.prefilter("אני שותה את הקפה שלי", "I drink my coffee", "קָפֶה"))  # behind a prefix

    def test_drafts_parser(self):
        self.assertEqual(len(gen_examples.drafts('```json\n[{"he":"א","en":"a"},{"he":"ב","en":"b"},{"he":"ג')), 2)

    def test_offensive_label(self):
        self.assertEqual(judge.offensive_label("הטקסט מנומס.\nתווית: 0"), 0)
        self.assertEqual(judge.offensive_label("תווית: **1** פוגעני"), 1)
        self.assertIsNone(judge.offensive_label("אין לי מושג"))

    def test_round_trip_overlap(self):
        self.assertGreaterEqual(judge.overlap("I want coffee with milk", "I want a coffee with milk."), 0.99)
        self.assertLess(judge.overlap("I promised you a drink, dear", "The weather is nice today"), 0.2)

    def test_ruling_detector(self):
        self.assertTrue(gen_ask.is_ruling("Am I allowed to eat pork?"))
        self.assertTrue(gen_ask.is_ruling("האם מותר להדליק אש בשבת?"))
        self.assertFalse(gen_ask.is_ruling("Who was Miriam?"))

    def test_agreement_reads(self):
        tok = lambda t, pos, func, head, **f: {"token": t, "lex": t, "syntax": {"dep_head_idx": head, "dep_func": func}, "morph": {"pos": pos, "feats": f}}  # noqa: E731
        good = {"tokens": [tok("ילדה", "NOUN", "nsubj", 1, Gender="Fem", Number="Sing"), tok("הלכה", "VERB", "root", -1, Gender="Fem", Number="Sing")]}
        self.assertTrue(judge.agreement(good)[0])
        bad = {"tokens": [tok("קפה", "NOUN", "root", -1, Gender="Masc", Number="Sing"), tok("גדולה", "ADJ", "amod", 0, Gender="Fem", Number="Sing")]}
        self.assertFalse(judge.agreement(bad)[0])
        # in context the model reads the wrong verb as agreeing; read alone it does not
        masked = {"tokens": [tok("הילדה", "NOUN", "nsubj", 1, Gender="Fem", Number="Sing"), tok("הלך", "VERB", "root", -1, Gender="Fem", Number="Sing", Tense="Past", Person="3")]}
        alone = {"הילדה": tok("הילדה", "NOUN", "root", -1, Gender="Fem", Number="Sing"), "הלך": tok("הלך", "VERB", "root", -1, Gender="Masc", Number="Sing", Tense="Past", Person="3")}
        self.assertTrue(judge.agreement(masked)[0])
        self.assertFalse(judge.agreement(masked, alone)[0])


if __name__ == "__main__":
    unittest.main()
