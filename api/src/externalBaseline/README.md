# External speedrun baselines

This component imports comparison records without mixing them into the
authoritative internal run, record, ghost, or split tables.

## Run

From `webpage/api`:

```sh
npm run import:external-baselines
```

The importer uses the existing `SPEEDRUN_DB_HOST`, `SPEEDRUN_DB_PORT`,
`SPEEDRUN_DB_USER`, `SPEEDRUN_DB_PASSWORD`, and `SPEEDRUN_DB_NAME`
configuration. It creates `speedrun_external_records` if the migration has not
already been applied.

Squishy map pages are fetched two at a time by default to keep memory use low
on the production host. `EXTERNAL_BASELINE_SQUISHY_CONCURRENCY` can override
this with a value from 1 through 8.

`map_id` stores the matched value from the existing `speedrun_maps.map`
identifier. It remains `NULL` when no normalized match exists. This project
currently identifies maps by the `map` string rather than a numeric ID.

Exit codes:

- `0`: all available records were processed successfully
- `1`: MariaDB was unavailable or initialization failed
- `2`: at least one source or record failed, while other records were retained

## Design

Each module under `importers/` owns only source-specific fetching and DOM
selection. It returns the shared normalized record shape. `normalizer.js`
handles map names, TFC class IDs, times, and in-memory deduplication.
`repository.js` owns table initialization, internal-map matching, and MariaDB
upserts.

To add a source:

1. Add an importer exporting `SOURCE` and `scrape(options)`.
2. Normalize every returned row with `normalizeRecord`.
3. Add the module to `SOURCES` in `externalBaselineImport.js`.
4. Add a parser fixture to `test/external-baseline.test.js`.

Selectors must be based on semantic headers, links, IDs, or other stable
attributes. Do not depend on absolute row, table, or column positions.
