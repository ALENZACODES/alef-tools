# Judge: does this verse speak to this question?

Used by `scripts/judge.py --type ask`. The judge sees the question and the quoted verse only. Both judges must say yes.
The answer's wording is a fixed template in `scripts/gen_ask.py`; no judge or generator writes it.

## system
אתה בודק התאמה בין שאלה על התורה לבין פסוק. ענה רק ב-JSON.

## user
שאלה: "{{question}}"
פסוק ({{ref}}): "{{verse}}"
הקטע המצוטט: "{{span}}"

האם הקטע המצוטט עונה ישירות על השאלה או עוסק בדיוק בנושא שלה? ענה "ok": true רק אם כן בבירור.
ענה בדיוק בצורה הזאת: {"ok": true או false, "reason": "כמה מילים"}
