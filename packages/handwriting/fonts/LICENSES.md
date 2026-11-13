# Fonts and data used to train the letter checker

No font file and no dataset file is stored in this repository or shipped in the app by this package. `scripts/render_fonts.py`
downloads the fonts below from the Google Fonts repository at one pinned commit, checks each file's SHA-256 against
`fonts.json`, and draws single letters from them to make training pictures. Only the trained model (`letters.onnx`) ships.

## Fonts: SIL Open Font License 1.1

Source: https://github.com/google/fonts at commit `35e77c3854970a550d9894a85aba21420813a019`. Every font below carries an `OFL.txt` in its folder there;
the script that built `fonts.json` refused any font whose `OFL.txt` did not name the SIL Open Font License. The OFL allows the
fonts to be used, studied and embedded freely; it restricts selling the font files on their own and reusing reserved font names,
neither of which happens here.

| Family | File (under google/fonts) | Style | Used for | Copyright line (first line of its OFL.txt) |
|---|---|---|---|---|
| Alef | `ofl/alef/Alef-Regular.ttf` | print | train | Copyright (c) 2012, HaGilda & Mushon Zer-Aviv (<http://alef.hagilda.com/alef@hagilda.com>), |
| Amatic SC | `ofl/amaticsc/AmaticSC-Bold.ttf` | print-hand | train | Copyright 2015 The Amatic SC Project Authors (https://github.com/googlefonts/AmaticSC) |
| Amatic SC | `ofl/amaticsc/AmaticSC-Regular.ttf` | print-hand | train | Copyright 2015 The Amatic SC Project Authors (https://github.com/googlefonts/AmaticSC) |
| Arimo | `ofl/arimo/Arimo[wght].ttf` | print | train | Copyright 2026 The Arimo Project Authors (https://github.com/googlefonts/arimo) |
| Assistant | `ofl/assistant/Assistant[wght].ttf` | print | train | Copyright 2020 The Assistant Project Authors (https://github.com/hafontia/Assistant). |
| Bellefair | `ofl/bellefair/Bellefair-Regular.ttf` | print | train | Copyright 2015 The Bellefair Project Authors (https://github.com/shinntype/bellefair) |
| Bona Nova | `ofl/bonanova/BonaNova-Regular.ttf` | print | train | Copyright 2020 The Bona Nova Project Authors (https://github.com/kosmynkab/Brygada-1918) |
| Cousine | `ofl/cousine/Cousine-Regular.ttf` | print | train | Copyright 2026 The Cousine Project Authors (https://github.com/googlefonts/cousine) |
| David Libre | `ofl/davidlibre/DavidLibre-Regular.ttf` | print | heldout | Copyright 2016 The David Libre Project Authors (https://github.com/meirsadan/david-libre), with reserved font name "Hadash", "Gentium" and 'SIL'. |
| Frank Ruhl Libre | `ofl/frankruhllibre/FrankRuhlLibre[wght].ttf` | print | train | Copyright 2015 The Frank Ruhl Libre Project Authors (https://github.com/fontef/frankruhllibre) |
| Fredoka | `ofl/fredoka/Fredoka[wdth,wght].ttf` | print | train | Copyright 2016 The Fredoka Project Authors (https://github.com/hafontia/Fredoka-One) |
| Gveret Levin | `ofl/gveretlevin/GveretLevin-Regular.ttf` | cursive | train | Copyright 2024 The Gveret Levin Project Authors (https://github.com/AlefAlefAlef/gveret-levin) |
| Heebo | `ofl/heebo/Heebo[wght].ttf` | print | train | Copyright 2014 The Heebo Project Authors (https://github.com/OdedEzer/heebo) |
| IBM Plex Sans Hebrew | `ofl/ibmplexsanshebrew/IBMPlexSansHebrew-Regular.ttf` | print | heldout | Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" |
| Karantina | `ofl/karantina/Karantina-Regular.ttf` | print-hand | train | Copyright 2020 The Karantina Project Authors (https://github.com/ronykoch/Karantina) |
| Miriam Libre | `ofl/miriamlibre/MiriamLibre[wght].ttf` | print | train | Copyright 2023 The Miriam Libre Project Authors (https://github.com/simoncozens/Miriam-Libre/) |
| Noto Sans Hebrew | `ofl/notosanshebrew/NotoSansHebrew[wdth,wght].ttf` | print | train | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/hebrew) |
| Noto Serif Hebrew | `ofl/notoserifhebrew/NotoSerifHebrew[wdth,wght].ttf` | print | train | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/hebrew) |
| Open Sans | `ofl/opensans/OpenSans[wdth,wght].ttf` | print | train | Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans) |
| Playpen Sans Hebrew | `ofl/playpensanshebrew/PlaypenSansHebrew[wght].ttf` | print-hand | train | Copyright 2023 The Playpen Sans Project Authors (https://github.com/TypeTogether/Playpen-Sans) |
| Rubik | `ofl/rubik/Rubik[wght].ttf` | print | train | Copyright 2015 The Rubik Project Authors (https://github.com/googlefonts/rubik) |
| Secular One | `ofl/secularone/SecularOne-Regular.ttf` | print | train | Copyright 2016 The Secular One Project Authors (https://github.com/googlefonts/secular) |
| Suez One | `ofl/suezone/SuezOne-Regular.ttf` | print | train | Copyright 2016 Michal Sahar. All rights reserved. |
| Varela Round | `ofl/varelaround/VarelaRound-Regular.ttf` | print | heldout | Copyright 2023 The Varela Round Project Authors (https://github.com/alefalefalef/Varela-Round-Hebrew/), with Reserved Font Names 'Varela' and ‘Varela Round’. |

"Used for": `train` fonts are drawn for training; `heldout` fonts are never trained on and are used only to score the model.

Left out on purpose: Solitreo (a different, historical cursive, which learners are not taught), Handjet, Rubik Doodle Shadow and
Rubik Scribble (decorative), M PLUS Rounded 1c (its licence file could not be fetched, so it was skipped).

## Real handwriting: HHD_v0, CC BY 4.0

I. Rabaev, B. Kurar Barakat, A. Churkin and J. El-Sana. *The HHD Dataset.* 17th International Conference on Frontiers in
Handwriting Recognition (ICFHR), pp. 228-233, 2020. Files: https://doi.org/10.5281/zenodo.4287442 (licence on the record:
Creative Commons Attribution 4.0 International). `hhd_dataset.rar`, 42,681,613 bytes, MD5 `d9b313c6d21a3533ec7713e0e6c0b02f`.

About 5,000 single handwritten (cursive) letters cut from hand-filled forms, already split into TRAIN and TEST. TRAIN (3,939
images used; folder 27, a stray mark, is not used) is part of training. TEST (1,134 images) is never trained on and is the
held-out real-handwriting score in the README. Credit line for the app: "Letter check trained in part on the HHD_v0 handwriting
dataset by I. Rabaev, B. Kurar Barakat, A. Churkin and J. El-Sana, CC BY 4.0."

## The app's own letter models

`--strokes` reads the stroke models in the app's `data/letters/letters.json` (the app's own data) and draws them with wobble.
The file is read from a local checkout and is not copied here.
