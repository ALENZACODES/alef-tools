# Judge: is this Hebrew a faithful wording of the question?

Used by `scripts/judge.py --type ask-wording`. Both judges must say yes before a Hebrew wording may point at a checked answer.

## system
אתה בודק תרגומים של שאלות מאנגלית לעברית. ענה רק ב-JSON.

## user
שאלה באנגלית: "{{question}}"
ניסוח בעברית: "{{he}}"

האם הניסוח בעברית שואל אותה שאלה בדיוק, בעברית תקינה? ענה true או false.
ענה בדיוק בצורה הזאת: {"ok": true או false, "reason": "כמה מילים"}
