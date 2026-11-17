"""The clip audit's own rules (no model, no audio): text folding, the Name, and what counts as a mismatch."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("audit_clips", Path(__file__).resolve().parents[1] / "audit-clips.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def test_letters_folds_points_finals_and_punctuation():
    assert audit.letters("שָׁלוֹם, עוֹלָם!") == "שלומ עולמ"
    assert audit.letters("כָּל־הָאָרֶץ") == "כל הארצ"


def test_name_is_expected_as_its_spoken_form():
    target, has = audit.spoken_target("בָּרוּךְ אַתָּה יְהוָה")
    assert has and target == "ברוכ אתה אדני"
    assert audit.spoken_target("שָׁלוֹם")[1] is False
    assert audit.is_name("וַיהוָה".replace("ַ", "").replace("ָ", "")) is True
    assert audit.is_name("יהודה") is False


def test_matching_clip_and_wrong_clip():
    clip = {"path": "audio/m/israeli/word/shalom.mp3", "tradition": "israeli", "kind": "word", "text": "שָׁלוֹם"}
    assert audit.judge(clip, "שלום")["match"] is True
    assert audit.judge(clip, "שלם")["match"] is True  # a vav left out in unpointed spelling is not a mismatch
    wrong = audit.judge(clip, "סלון גדול")
    assert wrong["match"] is False and wrong["cer"] > 0.34


def test_name_read_as_written_is_listed_even_when_the_rest_matches():
    clip = {"path": "audio/m/israeli/line/x.mp3", "tradition": "israeli", "kind": "line", "text": "בָּרוּךְ יְהוָה"}
    good = audit.judge(clip, "ברוך אדוני")
    assert good["match"] is True and good["hasName"] is True and good["nameAsWritten"] is False
    bad = audit.judge(clip, "ברוך יהווה")
    assert bad["nameAsWritten"] is True


def test_other_traditions_get_more_room():
    text = "שַׁבָּת"
    assert audit.judge({"path": "a", "tradition": "ashkenazi", "text": text}, "שבס")["match"] is True
    assert audit.judge({"path": "a", "tradition": "israeli", "text": text}, "שבס")["match"] is True  # one letter of three, inside the limit
    assert audit.judge({"path": "a", "tradition": "israeli", "text": text}, "כלב")["match"] is False
