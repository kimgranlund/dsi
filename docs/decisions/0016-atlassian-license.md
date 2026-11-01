# 0016 Publish Atlassian token values under the npm package's Apache-2.0

Status: accepted, 2026-11-01 (owner decision). Not legal advice.

## Context
`@atlaskit/tokens` 20.6.1 is licensed Apache-2.0 (`package/LICENSE`: "Copyright 2019 Atlassian Pty Ltd ... Licensed under the Apache License, Version 2.0"; `package.json` `"license": "Apache-2.0"`). Separately, the Atlassian Design System license at https://atlassian.design/license (updated 2025-03-13) grants ADS use for add-ons that "interoperate or are integrated with Atlassian's software and cloud products", and its Section 8 says: "The OSS licenses may grant you additional rights to the OSS code itself and allow you to use the OSS outside of the ADS."

## Decision
Ingest and publish Atlassian token names and values, redistributed under the npm package's Apache-2.0, with attribution and the license link on the site, as ADR 0009 does for Polaris. The ADS brand, logos and imagery are not used.

## Consequences
`sources/atlassian/source.json` records `redistribution: permitted` with this reasoning. If Atlassian changes the package license, re-check before ingesting the new version.
