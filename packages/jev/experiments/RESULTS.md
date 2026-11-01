# Jev experiment results

Appended by `dsi-jev run`. Full results: `.cache/jev/results/<name>.json`.

| Experiment | Model | Items | Joint % | Facet accuracy % | ECE % | Acc@0.8 (coverage) | Calls (cached) | Tokens in/out |
|---|---|---|---|---|---|---|---|---|
| e00-smoke | jev-1.14.0 | 1 | 100 | intent 100, property 100 | 11 | null (0) | 1 (0) | 829/169 |
| e01-facets-full | jev-1.14.0 | 70 | 10 | intent 77.1, usage 34.3, hue 42.9, property 91.4, emphasis 75.7, state 100 | 11.1 | 0 (1.4) | 70 (0) | 147757/40184 |
| e02-facets-name | jev-1.14.0 | 70 | 11.4 | intent 65.7, usage 41.4, hue 68.6, property 91.4, emphasis 70, state 100 | 11.6 | 0 (1.4) | 70 (0) | 144397/40194 |
| e03-facets-desc | jev-1.14.0 | 70 | 14.3 | intent 74.3, usage 38.6, hue 74.3, property 87.1, emphasis 70, state 100 | 7.5 | 0 (1.4) | 41 (29) | 85186/23543 |
| e04-facets-siblings | jev-1.14.0 | 70 | 15.7 | intent 75.7, usage 42.9, hue 45.7, property 92.9, emphasis 71.4, state 100 | 9.6 | 100 (1.4) | 50 (20) | 108472/28727 |
| e05-facets-labels | jev-1.14.0 | 70 | 10 | intent 72.9, usage 32.9, hue 58.6, property 84.3, emphasis 68.6, state 100 | 8.8 | 100 (1.4) | 70 (0) | 96447/40195 |
| e06-facets-json | jev-1.14.0 | 70 | 10 | intent 75.7, usage 32.9, hue 42.9, property 91.4, emphasis 68.6, state 100 | 9.9 | 0 (1.4) | 70 (0) | 149526/40200 |
| e07-facets-rich | jev-1.14.0 | 70 | 10 | intent 71.4, usage 35.7, hue 42.9, property 88.6, emphasis 78.6, state 100 | 11.8 | 100 (2.9) | 70 (0) | 160357/40186 |
| e08-registry-k5 | jev-1.14.0 | 70 | 92.9 | concept 92.9 | 8.5 | 98.1 (75.7) | 70 (0) | 33476/4060 |
| e09-registry-k10 | jev-1.14.0 | 70 | 88.6 | concept 88.6 | 8.1 | 97.9 (67.1) | 70 (0) | 42631/6934 |
| e10-noul-pair | jev-1.14.0 | 70 | 71.4 | noul-pair 94.3, noul-gold>0.5 72.9 | 31.6 | 100 (7.1) | 70 (0) | 25991/2660 |
| e11-facets-grammar | jev-1.14.0 | 70 | 27.1 | intent 75.7, usage 42.9, hue 81.4, property 92.9, emphasis 71.4, state 100 | 5.9 | 90.9 (15.7) | 0 (70) | 0/0 |
| e12-facets-boost | jev-1.14.0 | 70 | 34.3 | intent 84.3, usage 45.7, hue 81.4, property 92.9, emphasis 77.1, state 100 | 5.4 | null (0) | 0 (70) | 0/0 |
| e13-facets-general | jev-1.14.0 | 70 | 27.1 | intent 72.9, usage 44.3, hue 81.4, property 91.4, emphasis 72.9, state 100 | 6.5 | 92.3 (18.6) | 70 (0) | 150564/40206 |
| e14-two-stage-k5 | jev-1.14.0 | 70 | 62.9 | recall@k 77.1, concept 62.9 | 18.9 | 78.1 (45.7) | 70 (70) | 36172/4060 |
| e15-two-stage-k10 | jev-1.14.0 | 70 | 58.6 | recall@k 81.4, concept 58.6 | 14.7 | 86.2 (41.4) | 70 (70) | 45471/6930 |
| e16-two-stage-k20 | jev-1.14.0 | 70 | 60 | recall@k 85.7, concept 60 | 13.7 | 87.9 (47.1) | 70 (70) | 64379/13235 |
| e17-owner-choice | jev-1.14.0 | 257 | 18.3 | concept 37.4, agent-baseline 23.7 | 54.1 | 43.9 (22.2) | 257 (0) | 102056/8762 |
| e18-owner-choice-siblings | jev-1.14.0 | 257 | 19.8 | concept 38.5, agent-baseline 23.7 | 49.8 | 45.3 (20.6) | 79 (178) | 36463/2710 |
| e19-owner-choice-plus3 | jev-1.14.0 | 257 | 19.8 | concept 68.5, agent-baseline 23.7 | 48.4 | 62.2 (17.5) | 257 (0) | 126905/14866 |
| e17-owner-choice | jev-1.14.0 | 84 | 44 | concept 58.3, agent-baseline 60.7 | 30.5 | 64.9 (44) | 0 (84) | 0/0 |
| e18-owner-choice-siblings | jev-1.14.0 | 84 | 48.8 | concept 61.9, agent-baseline 60.7 | 31.5 | 69.7 (39.3) | 0 (84) | 0/0 |
| e19-owner-choice-plus3 | jev-1.14.0 | 84 | 48.8 | concept 61.9, agent-baseline 60.7 | 27.3 | 66.7 (46.4) | 0 (84) | 0/0 |
| e20-two-stage-k10-post | jev-1.14.0 | 70 | 54.3 | recall@k 64.3, concept 54.3 | 24.3 | 84.8 (47.1) | 67 (73) | 42041/6635 |
| e21-two-stage-k10-family | jev-1.14.0 | 70 | 47.1 | recall@k 60, concept 47.1 | 29.7 | 75 (45.7) | 49 (91) | 31926/4852 |
| e22-two-stage-k10-family-owner | jev-1.14.0 | 70 | 55.7 | recall@k 67.1, concept 55.7 | 26.9 | 81 (60) | 124 (16) | 176109/41771 |
| c1-facets-boost-seed2 | jev-1.14.0 | 70 | 28.6 | intent 81.4, usage 50, hue 84.3, property 92.9, emphasis 70, state 98.6 | 6.3 | null (0) | 54 (16) | 116566/31015 |
| c2-two-stage-k20-seed2 | jev-1.14.0 | 70 | 64.3 | recall@k 92.9, concept 64.3 | 7.6 | 93.9 (47.1) | 56 (84) | 52014/10587 |
| c3-noul-pair-seed2 | jev-1.14.0 | 70 | 77.1 | noul-pair 95.7, noul-gold>0.5 77.1 | 33.6 | 100 (4.3) | 56 (14) | 20972/2128 |
| e23-noul-audit-sweep | jev-1.14.0 | 1133 | 91.4 | gold-beats-all 91.4 | 52 | 100 (4.9) | 1133 (0) | 490137/81576 |
| e24-usage-noul | jev-1.14.0 | 70 | 51.4 | usage-set 51.4, usage-top 52.9 | 26.3 | 50 (5.7) | 70 (0) | 59774/17850 |
| e25-usage-noul-t07 | jev-1.14.0 | 70 | 51.4 | usage-set 51.4, usage-top 52.9 | 26.3 | 75 (5.7) | 0 (70) | 0/0 |
| e23-noul-audit-sweep | jev-1.14.0 | 1133 | 91.4 | gold-beats-all 91.4 | 52 | 100 (4.9) | 0 (1133) | 0/0 |
| r5-a-baseline | jev-1.14.0 | 140 | 25 | intent 73.6, usage 47.1, hue 81.4, property 90.7, emphasis 74.3, state 95.7 | 5.3 | null (0) | 103 (38) | 219465/58595 |
| r5-b-drafts | jev-1.14.0 | 140 | 22.9 | intent 75, usage 48.6, hue 82.1, property 90.7, emphasis 68.6, state 95.7 | 3.7 | null (0) | 141 (0) | 304287/80411 |
| r5-c-contrastive | jev-1.14.0 | 140 | 30 | intent 77.1, usage 61.4, hue 84.3, property 91.4, emphasis 71.4, state 95 | 5.7 | 100 (0.7) | 141 (0) | 324307/80401 |
| r5-d-evidence | jev-1.14.0 | 140 | 30 | intent 77.1, usage 60.7, hue 84.3, property 92.1, emphasis 70.7, state 95 | 5.8 | 100 (0.7) | 13 (128) | 28102/6908 |
| r5-e-conventions | jev-1.14.0 | 140 | 27.9 | intent 79.3, usage 59.3, hue 85, property 94.3, emphasis 67.9, state 96.4 | 5 | 100 (0.7) | 108 (33) | 249348/61480 |
| r5-e0-no-conventions | jev-1.14.0 | 140 | 27.9 | intent 80, usage 58.6, hue 84.3, property 94.3, emphasis 70, state 96.4 | 4.9 | 100 (0.7) | 17 (124) | 37932/9216 |
| r5-f-staged | jev-1.14.0 | 140 | 30.7 | property 91.4, usage 60, intent 77.9, hue 84.3, emphasis 72.1, state 95 | 5.8 | 100 (0.7) | 281 (0) | 376417/80820 |
| r5-g-merged | jev-1.14.0 | 84 | 45.2 | recall 90.5, concept 54.8, agent-baseline 60.7 | 20.2 | 70 (35.7) | 157 (12) | 212138/46679 |
| r5-h-words | jev-1.14.0 | 198 | 39.4 | word-facet 57.5, word-value 39.5 | 14.2 | 79.7 (37.4) | 201 (0) | 487939/127997 |
