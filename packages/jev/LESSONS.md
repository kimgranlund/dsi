# Jev lessons

Durable findings about using Jev for DSI mapping, each with the experiments that show it. Hypotheses that did not hold stay here too, marked as such. Raw numbers: `experiments/RESULTS.md`.

## Before any call (2026-11-01, from building the lab)

- **Use the official endpoint only.** docs.typesafe.ai lists `api.typesafe.ai/v1/systemone`. A Hugging Face community post points to another domain (thejevai.com) and is not official.
- **Limit choices to what the domain uses.** Offering every facet value gave color tokens typography usages (heading, body) as options. Criteria now come from values that registered color concepts use: 10 intents, 16 usages, 15 hues, 8 properties, 7 emphases, 8 states, plus none.
- **Jev answers one question at a time, in isolation.** Facet Choices cannot see each other, so combinations must be assembled and validated afterwards (`parseConcept`). Usage is multi-valued; a single Choice can only name one member.
- **Request size.** A full-state, six-facet request is about 1,400 input tokens; the 70-item matrix experiment is about 97,000.
