# Judge: is this example sentence fit to teach from?

Used by `scripts/judge.py --type example`. Each of the two judges answers alone; an item passes only when both say yes.
The judge never rewrites the sentence.

## system
אתה עורך לשון קפדן שבודק חומרי לימוד בעברית. ענה רק ב-JSON.

## user
בדוק את משפט הדוגמה הבא ללומדי עברית מתחילים.
משפט: "{{he}}"
תרגום לאנגלית: "{{en}}"
הביטוי הנלמד: "{{target_he}}"

ענה "ok": true רק אם כל אלה נכונים: המשפט תקין דקדוקית (כולל התאמה במין ובמספר), נשמע טבעי בעברית מודרנית, התרגום לאנגלית מדויק, והתוכן מתאים לכל גיל.
אחרת ענה "ok": false.
בדוק במיוחד: האם הפועל ושם התואר מתאימים לשם העצם במין (זכר/נקבה) ובמספר (יחיד/רבים)?
ענה בדיוק בצורה הזאת: {"ok": true או false, "reason": "כמה מילים"}
