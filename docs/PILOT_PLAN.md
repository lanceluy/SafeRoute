# Pilot and field-audit plan

Two gaps remain that only people can close: no real-user pilot, and routing quality measured only
on synthetic ground truth. This plan collects both with one small outing. Nothing here has been run;
the analysis code (`benchmark/pilot/analyze.mjs`) is tested on fixtures only, so every number in the
paper must come from real CSVs, not from the examples in the tests.

## 0. Before anyone is recruited

- Ask your school's ethics or research office whether a usability study with location data needs
  review. Do this first; it can take weeks.
- Participants must give informed consent, be told what is collected (hazard reports, location while
  using the app, survey answers), and be able to withdraw. Philippine data-privacy law applies to
  personal data you collect; check with the same office.
- Run it on a **staging backend** with test accounts and a separate database, never the dev database.
  Do not reuse a participant's real email. Hazard coordinates go to OpenStreetMap's Nominatim for street
  names in the portal; say so in the consent text or turn that lookup off for the study.
- Rate limiting is per IP. A room of participants on one campus Wi-Fi will share an IP and hit the
  registration limit (3 per hour). Pre-create the accounts, or raise that limit on the staging server only.

## 1. Usability pilot (item 7)

| | |
|---|---|
| Participants | 12–20 pedestrians who walk in Makati or a similar area. Mix of ages. Not the development team. |
| Duration | About 25 minutes each, one at a time, in a quiet spot with the iOS app on a real iPhone. |
| Tasks | T1 sign in and find the nearest hazard. T2 report a hazard. T3 confirm someone else's report. T4 request a route between two given points and say which hazard it avoids. T5 turn on quiet hours. |
| Measures | Per task: success (1/0), seconds, number of errors. After the tasks: the 10-item System Usability Scale. Free comments: "what confused you?" |
| Output files | `tasks.csv` and `sus.csv` (templates in `benchmark/pilot/templates/`). Use participant codes (P01, P02), never names. |

```bash
node benchmark/pilot/analyze.mjs sus   pilot/sus.csv
node benchmark/pilot/analyze.mjs tasks pilot/tasks.csv
```

With 12–20 people the SUS confidence interval is wide (roughly ±8 points). Report the interval, not just
the mean, and call this a usability pilot, not proof of effectiveness.

## 2. Field route audit (item 3)

Goal: check on real streets whether the routes SafeRoute picks pass fewer hazards than the shortest
route, and whether the hazards the app lists are really there.

1. **Seed the map.** Over one or two days, have a few people report the hazards they genuinely see in
   the study area. Moderators remove obviously wrong ones. Freeze the dataset before auditing.
2. **Choose 20 or more origin–destination pairs**, 600–1,500 m apart, picked before looking at which routes
   differ. Include pairs where both routes are the same; they are part of the honest result.
3. **Walk both routes for each pair on the same day**, shortest first or SafeRoute first in random order.
   Record: metres, hazards seen, how many of those are **high severity** by the rubric below, how many were
   already listed in the app, how many hazards the app listed along the route, and how many of those you
   confirmed in the field. One row per walked route in `field-audit.csv`.
4. **Severity rubric** (write it down before walking so two auditors agree): high = a pedestrian cannot pass
   safely or could be injured (open manhole, knee-deep or deeper flooding, collapsed sidewalk); medium =
   passable with care; low = nuisance. If two people audit, report how often they agreed.

```bash
node benchmark/pilot/analyze.mjs audit pilot/field-audit.csv
```

The output gives the paired reduction in high-severity hazards (with a bootstrap 95 % interval), the average
detour, and the app's precision (listed hazards confirmed in the field) and recall (observed hazards already
in the app). Quote these as they come out, including when the interval includes zero.

## 3. What you may claim afterwards

- With a pilot and audit completed: usability (SUS with interval), task success, and routing exposure on
  real routes in one area at one time.
- You still may not claim: citywide accuracy, long-term trust behaviour, or performance at scale.
