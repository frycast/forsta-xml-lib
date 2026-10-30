# Synthetic rehearsal sample

Upload format: UTF-8 comma-separated CSV, exactly `Id,tier,locale`. Id is unique text; leading zeros are significant. tier is basic/pro; locale is en/fr. No other fields or derivations. Use only these allocated synthetic records:

| Id | tier | locale |
| --- | --- | --- |
| 0001 | pro | en |
| 0002 | basic | fr |
| 0003 | basic | en |
| 0004 | pro | fr |
| 0005 | pro | en |

Use 0001-0004 for distinct cases and 0005 for one fresh reproduction of the 0001 case, giving five attempts for the capability batch. This is a fixture constraint, not a real-survey interview-count rule. Case IDs remain independent of Id.

There is no upload service: generate sample.csv locally, then use the supplied returned export to simulate delivery. Its preloads match these records. Browser scope permits synthetic answers, validation probes and completion on this localhost fixture only. Stop at Complete or Ineligible. The mock has no backend respondent persistence; reloading restarts an interview and cannot establish real-world resume behavior.
