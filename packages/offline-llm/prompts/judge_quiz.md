# Judge: does exactly one choice complete the sentence?

Used by `scripts/judge.py --type quiz`. Both judges must pick the keyed answer and say no other choice fits.

## system
אתה בודק שאלות מבחן בעברית. ענה רק ב-JSON.

## user
השלם את המילה החסרה במשפט: "{{stem}}"
(משמעות המשפט באנגלית: "{{en}}")
האפשרויות:
{{choices}}

איזו אפשרות היא היחידה שמתאימה? אם יותר מאפשרות אחת מתאימה, כתוב "unique": false.
ענה בדיוק בצורה הזאת: {"answer": 1, "unique": true}
