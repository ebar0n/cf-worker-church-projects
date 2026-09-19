# Adventurers activity audit — 2026-09-19

Scope: all 18 activities, their reading and parent instructions, printable content,
DOM interaction, age variants, scoring, offline retries and daily limits. Baseline:
`c48cbe6`; release: 1.0.1.

The repository README and each activity's stated objective are the camp requirements
available for this audit. No original camp bulletin was provided, so event-specific
colors, class requirements and scoring rubrics remain based on those local guidelines.
Practice points are not an official camp grade. Oral performance still requires an
adult; an automated UI test cannot establish that a child recited, sang or prayed.

## Activity findings

| Activity | Objective/source | Result and correction | Daily ceiling card/quiz |
|---|---|---|---|
| Los cinco colores | Match five OT families to the camp colors; 39 books | Every choice was marked wrong because of mismatched property/data names. Correct and incorrect paths now work. | 5/0 |
| Antes o después | Recall the next book and order a full family | Fixed dead option/tile handlers, book data lookup and missing wrong-answer hint. | 3/2 |
| Organiza la Biblia | Classify books, then order families against a clock | Fixed both game modes' controls, position lookup, result crash, overlapping hint styles, printable class names and untranslated labels. A clean five-book block earns one point; one ordering award per family/day. | 5/5 |
| El voto | Recite the Adventurer pledge with progressively hidden text | Reading and adult-confirmed rounds agree; no activity logic change needed. | 2/0 |
| La ley | Recite all ten points, recall their order | Fixed dead options and wrong distractor/feedback properties. Parent instructions now accurately describe choosing the first of three points. | 2/3 |
| El himno | Continue the Adventurer hymn from a prompt | Lyrics and adult-confirmed rounds reviewed; no activity logic change needed. | 3/0 |
| Mesa del rey / Daniel (PR39) | Daniel 1:8–16 and PR39; distinguish the rejected food/wine from simple food/water | Verified four qualifying streaks plus oral answer. Every illustrative food now explicitly says it is an example, not an item named in the chapter. | 5/0 |
| La prueba de diez días | Put Daniel's decision, request and test in order (Daniel 1; PR39) | Chronology and age-dependent length reviewed; completed both age paths. Corrected visible untranslated label. | 5/0 |
| Nombres | Match Hebrew/Babylonian names and supporting PR39 facts | Fixed missing quiz explanation, mismatch styling cleanup and async award callback touching a finished match. Clarified full-board base point versus flip bonus. Easy/full games yield 2/3 card points per play, with a daily ceiling of 4. | 4/2 |
| Colorear | Identify people/objects in Daniel 1 illustrations and explain Daniel's decision | Matched server/client ceiling to the three actual identifying rounds. Removed false claims that a nonreader can play alone and that every drawn object is named explicitly in the text. Colors remain free choice. | 3/1 |
| La estatua del sueño | Match Daniel 2:32–33 metals; distinguish Daniel 3's all-gold image | Preserved half-completed feet when another part is completed in free mode. Verified both materials and older children's two source questions. | 5/2 |
| La cadena del horno | Explain cause/effect in Daniel 3 and PR41 | Fixed undefined variable that crashed review. Short chains now always retain the refusal to worship and the rescue; random omissions previously removed the central event for younger children. | 5/1 |
| El versículo | Recite Isaiah 43:2 as quoted in PR41, then reference | Verified progressive hiding, final text award, citation award only for older classes, and local daily tracking. No activity logic change needed. | 1/1 |
| ¿Qué falta en el foso? | Observe, locate and name elements in the Daniel 6/PR44 scene | Both location and name required; younger 3 rounds, older 5 plus 2 source questions. Corrected visible untranslated labels. | 5/2 |
| ¿Quién lo dijo? | Identify speakers, act three voices, identify addressee (Daniel 6/PR44) | Reviewed attribution, no-point practice and adult-confirmed acting. Revealing a hidden line makes it practice. No activity logic change needed. | 3/1 |
| El reloj de oración | Three daily prayer moments plus source recall and family application (Daniel 6/PR44) | Fixed broken hint property. Corrected three assertions that Daniel had prayed through all 30 days before arrest: 30 days is the decree's duration. Unmark/re-mark does not repay a moment. | 3/2 |
| Padres: limpieza | Read CN17 and practice its written questions | Chapter references, answer bank, explanations and 10-question completion reviewed. No game logic change needed. | 0/5 |
| Padres: pulcritud, orden y regularidad | Read CN18 and practice its written questions | Chapter references, answer bank, explanations and 10-question completion reviewed. No game logic change needed. | 0/5 |

## Source boundaries

- [Profetas y Reyes 39](https://text.egwwritings.org/read/217.1871),
  [41](https://text.egwwritings.org/read/217.1974),
  [44](https://text.egwwritings.org/read/217.2125), and the chapter extracts already
  included in each activity. Direct full-page retrieval was restricted; source
  search excerpts supplemented the in-repository reading.
- Daniel 1, 2, 3 and 6; Isaiah 43:2. The literal memorization text follows the PR
  quotation and is not silently rewritten to match a different Bible edition.
  The repository's camp overview mentions RV1995, while some existing reading links
  use RVR1960; exact recitation wording needs the original bulletin to settle.
- [Adventurer ideals, Inter-American youth ministry](https://mundoja.org/ideales/aventureros).
- [Conducción del niño 17](https://text.egwwritings.org/read/157.510) and
  [18](https://text.egwwritings.org/read/157.534); the historical source readings and
  paragraph references are preserved.

## Scoring and verification

The old independent total update and interaction insert could race. A D1 batch now
inserts within the daily cap and increments the total only for that insert. A unique
player/request ID prevents duplicate awards after lost responses. Legacy clients
without request IDs remain accepted and capped. Migration 0005 is additive.

The shared profile reserves queued offline points against the cap, retains requests
on 5xx, freezes the answering child's identity, prevents another child's replay from
replacing the active profile, resets counts on a Bogotá day change and displays the
activity's actual cap. Version 1.0.1 is stamped on all activity pages and the SW cache.

Verification commands:

- `yarn verify`: activity contract, exploratory clicks/broken text, 36 completed
  activity/age paths with exact awards, wrong-answer regressions, partial feet,
  short-chain content, offline/profile isolation and retry tests.
- `yarn verify:api` with `yarn dev`: real local D1, 8 concurrent deliveries of one
  attempt, 15 concurrent new attempts competing for four remaining points, cap-zero
  rejection, validation, wrong answers, replay at cap and activity independence.
- Browser: responsive controls and feedback at 390 × 844; production login and
  post-deployment verification are recorded in the PR/task completion report.

No test-only profile or document number is shipped. Integration tests create their
own synthetic local profile and refuse production hosts.
