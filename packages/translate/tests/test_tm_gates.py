# ruff: noqa: E401, E701, E702, E731, E741
"""The checks a translation-memory entry must pass. Run: python3 -m unittest discover -s packages/translate/tests -p 'test_*.py'"""
import json, os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
import tm_gates as G

FORMS = G.number_forms({'list': [{'n': 3, 'count': 'שלוש', 'm': 'שלושה'}]})
NOUNS = G.noun_table([{'en': ['ticket'], 'he': 'כרטיס', 'pl': 'כרטיסים'}, {'en': ['water'], 'he': 'מים', 'pl': 'מים'}])
ok = lambda he, en: G.rule_checks(G.tm_key(he), en, FORMS, NOUNS)


class Gates(unittest.TestCase):
    def test_keys_match_the_fixture_the_browser_code_is_tested_against(self):
        fx = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'tm-keys.json'), encoding='utf8'))
        for line, key, h in fx['keys']:
            self.assertEqual(G.tm_key(line), key); self.assertEqual(G.fnv1a(key), h)

    def test_the_name_is_held_and_sacred_lines_are_never_machine_translated(self):
        name = 'יהוה'
        self.assertTrue(G.holds_name('ברוך ' + name)); self.assertTrue(G.holds_name('הודו ל' + name + ' כי טוב')); self.assertTrue(G.holds_name('Praise Yahweh'))
        self.assertFalse(G.holds_name('שלום עולם'))
        self.assertTrue(G.is_sacred('בּוֹרֵא פְּרִי הַגָּפֶן׃')); self.assertTrue(G.is_sacred('ברוך אתה אדני')); self.assertTrue(G.is_sacred('שלום', 'corpus/reader/shema.json'))
        self.assertTrue(G.is_sacred('שלום רב', '', {'ref': 'Psalm 1'})); self.assertTrue(G.is_sacred('מִן־כָּל־בִּרְכָתָא'))
        self.assertFalse(G.is_sacred('איפה תחנת האוטובוס?', 'curriculum/lessons.json'))

    def test_numbers(self):
        self.assertEqual(ok('אני רוצה שלוש בירות', 'I want three beers.'), [])
        self.assertTrue(ok('אני רוצה שלוש בירות', 'I want two beers.'))
        self.assertEqual(ok('יש לי שני כרטיסים למשחק', 'I have two tickets for the game.'), [])
        self.assertEqual(ok('ביום יש עשרים וארבע שעות', 'There are twenty-four hours in a day.'), [])
        self.assertEqual(ok('הלימודים מתחילים ביום שני הבא', 'School starts next Monday.'), [])
        self.assertEqual(ok('יש שלוש מאות אנשים כאן', 'There are three hundred people here.'), [])
        self.assertTrue(ok('הוא גר כאן הרבה זמן', 'He has lived here for five years.'))

    def test_person_and_count(self):
        self.assertTrue(ok('היא רואה את התג', 'He sees the tag.')); self.assertEqual(ok('היא רואה את התג', 'She sees the tag.'), [])
        self.assertTrue(ok('אני גרה בתל אביב', 'You live in Tel Aviv.')); self.assertTrue(ok('אנחנו רוצים לאכול', 'They want to eat.'))
        self.assertTrue(ok('איפה קונים את הכרטיסים האלה', 'Where do you buy this ticket?')); self.assertEqual(ok('איפה קונים את הכרטיסים האלה', 'Where do you buy these tickets?'), [])

    def test_shape_round_trip_and_agreement(self):
        self.assertTrue(ok('אני רוצה קפה', '')); self.assertTrue(ok('אני רוצה קפה', 'I want קפה')); self.assertTrue(ok('אני רוצה קפה עם חלב', 'I'))
        self.assertEqual(G.check_machine_shape('Forward forward please.'), 'a word is said twice in a row'); self.assertIsNone(G.check_machine_shape('Move forward, please.'))
        bad, score = G.check_round_trip(G.tm_key('אני יורדת בתחנה הבאה'), 'אני יורד בתחנה הבאה.'); self.assertIsNone(bad); self.assertGreater(score, 60)
        bad, _ = G.check_round_trip(G.tm_key('אני מצטערת על האיחור'), 'אני מצטער על הגב'); self.assertIsNotNone(bad)
        self.assertIsNone(G.check_agreement("I'm getting off at the next stop.", 'I am getting off at the next station.')[0])
        self.assertIsNotNone(G.check_agreement('Ilan is synonymous with the tree', 'Ilan is a tree name.')[0])


if __name__ == '__main__':
    unittest.main()
