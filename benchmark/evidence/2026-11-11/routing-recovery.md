# Makati routing study recovery

The original OSM walking-network inputs, 300-trip routing script, and study outputs
were not found in the checked local copies, benchmark Git history, or connected
Google Drive searches. The search for a folder named ZZ Mapua returned no match.
The machine where the study may have run has not been checked.

The current repository contains `benchmark/sensitivity/sweep.mjs`, which uses
synthetic ground truth. It does not reproduce the reported Makati OSM study.

A follow-up check of the available Mac files and local Git refs found
`backend/scripts/data/makati-streets.json` and `seed-makati-hazards.mjs` in
the older Desktop checkout. The JSON contains Overpass street geometry for
seeding test hazards. It does not contain the 300 sampled trips, routing
outputs, or merge-split analysis needed to reproduce Setup C. The original
machine or a study archive remains the next place to check.
