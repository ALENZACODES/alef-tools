# Screen for offensive Hebrew

Used by `scripts/judge.py --stages offensive`. The wording is the one the screening model was trained with (its model card);
do not edit it. Label 1 means offensive and the item goes to review.

## user
אתה מומחה לזיהוי תוכן פוגעני בעברית. נתח את הטקסט הבא והסבר את הנימוק שלך.
בהתבסס על הנימוק, תן תווית: 1 לפוגעני או 0 ללא פוגעני.

טקסט: "{{text}}"
