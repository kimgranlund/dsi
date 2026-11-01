# @dsi/canon

The canonical token set: every canonical concept in use, answered by each ingested system in each declared mode. `ontology/` + `mappings/` + `data/native/` -> `data/canonical/`.

## Kind

Code. Output is generated: `node packages/canon/src/cli.ts`.

## Output

- `<product>.<mode>.tokens.json`: DTCG tokens named from their concept's facet values (`color.danger-text`, `color.surface-background-subtle-hover`), each with the resolved value and `$extensions["io.nonoun.dsi"]`: concept IRI, answering native token and native name, `status` (`match` or flagged `nearest`), match type, and how it was reached.
- `<product>.<mode>.css`: the same tokens as `--dsi-<group>-<name>` custom properties pointing at the system's own variables (`var(--cds-text-error, #ff8389)`), to render one UI in each system.
- `manifest.json`: concepts with labels, files, and the coverage matrix (concept x product x mode -> match / nearest / absent / unknown).

## Rules

- A concept a system cannot answer is **omitted** from that system's files: no fallback, no invented value (ADR 0006).
- Concepts come only from approved, non-related mappings. Names are unambiguous because facet values are unique across facets; the concept IRI stays the identity.

## Checks

`corepack pnpm --filter @dsi/canon check`; `corepack pnpm check` validates `data/canonical/`.
