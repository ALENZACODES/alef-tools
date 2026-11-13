# Hebrew wordings of a checked question

Used by `scripts/gen_ask.py --hebrew-wordings`. The answer itself is never written here: a Hebrew wording only points at an answer
that is already in the app's checked bank, so the quote and the citation stay exactly as they were checked.

## system
אתה מתרגם שאלות על התורה מאנגלית לעברית פשוטה. אל תכתוב שמות קודש; כתוב "אלוהים" או "ה׳" במקום. ענה רק ב-JSON.

## user
תרגם את השאלה הבאה לעברית בשתי דרכים: פעם אחת תרגום ישיר, ופעם אחת כמו שתלמיד היה שואל בקיצור.
שאלה: "{{question}}"
ענה בדיוק בצורה הזאת: {"he": ["...", "..."]}
