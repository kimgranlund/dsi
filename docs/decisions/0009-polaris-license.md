# 0009 Publish Polaris token values despite its license restriction

Status: accepted, 2026-10-31

## Context
`@shopify/polaris-tokens` is MIT plus a restriction: rights may only be exercised to build applications that integrate with Shopify. Republishing values in a public index likely falls outside it.

## Decision
The owner chose to ingest and publish Polaris values, accepting the license risk. Recorded as `license.redistribution: restricted` with a `publishOverride` (who, when, why) in `sources/polaris/source.json`; the override never changes `redistribution`.
