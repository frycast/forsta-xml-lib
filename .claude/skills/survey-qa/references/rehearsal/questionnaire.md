# Synthetic rehearsal questionnaire

These requirements are independent of the mock implementation. All answers are synthetic.

| Check | Intended behavior |
| --- | --- |
| K01 | Q1 Eligible? Required Yes/No. No ends at Ineligible; Yes continues to Q2. |
| K02 | Q2 Issues: Housing (H), Work (W), Other (O), None (N). Required multi-select with shuffled order. None clears other selections; selecting an issue clears None. Next without an answer shows an error and stays on Q2; a valid answer recovers. |
| K03 | Q3 Other text is required only when O is selected. |
| K04 | Q4 loops once per selected issue except N, in H/W/O order. Each heading pipes the issue label, or the exact Other text. Each iteration requires impact Low (L) or High (H), with shuffled option order. N produces zero iterations. |
| K05 | Q5 Pro advice, required Yes/No, appears only for tier pro. Basic skips it. |
| K06 | The final page is Complete, with Thank you for locale en and Merci for fr. Ineligible does not show Complete. |

Cover early termination, zero/one/multiple loops, Other piping, both tiers/locales, exclusivity and validation recovery. Select shuffled options by label/code. Ordinary impact/advice answers may use any valid option when not fixed by a case.
