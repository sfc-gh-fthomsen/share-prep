# Share Prep

Pick Snowflake tables and columns, choose how they are protected (zero-copy clone, masked copy, or synthetic data), choose where the prepared copies are stored, and distribute them through a direct share, a private listing, or an Internal Marketplace (organization) listing. Every action is shown as a SQL manifest first and only runs when you confirm.

> **Sample code, provided as is.** Not an official Snowflake product. Review the generated SQL before running it, and try it in a non-production account first.

## Run it in Cortex Code Desktop (CoCo)

### Prerequisites

- [Cortex Code Desktop](https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code) installed and signed in to your Snowflake account
- [Node.js](https://nodejs.org) 20 or later (`node --version`)
- [Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli/installation/installation) with a connection in `~/.snowflake/connections.toml`, set as the default (`default_connection_name` in `~/.snowflake/config.toml`). The app uses that connection's user and role locally.
- A default warehouse for that user

### Steps

1. **Clone the repo.** In CoCo Desktop, open a terminal, or type `!` in the chat to run a shell command:
   ```bash
   git clone https://github.com/sfc-gh-fthomsen/share-prep.git
   ```
2. **Open the folder** in CoCo Desktop: *File → Open Folder…* and choose `share-prep`, or run `coco share-prep` from a terminal.
3. **Ask CoCo to run it.** In the chat panel, type:
   > Install the dependencies and run this app locally, then open it in the browser.

   CoCo reads `AGENTS.md`, runs `npm install` and `npm run dev`, and opens http://localhost:3000 in its built-in browser. To do it by hand instead:
   ```bash
   cd share-prep
   npm install
   npm run dev
   ```
   Then open http://localhost:3000. The first query may open a browser tab for Snowflake sign-in.
4. **Use it.** Pick a database, schema and tables, choose a treatment, a destination and a delivery method, review the manifest on the right, and press **Run manifest**.

### Optional: deploy it to Snowflake

Ask CoCo: *"Deploy this app to Snowflake"*. CoCo uses the `snowflake-apps` skill to generate the deployment manifest (`snow app setup`) and run `snow app deploy`. This needs a recent Snowflake CLI (`snow app setup --help` must work) and the caller grants described under [Caller grants](#caller-grants-required-once-deployed).

## Design brief

- **Who and when:** a data engineer or data steward who has been asked to hand a dataset to a partner, another account, or another team, and has to decide in a few minutes what leaves the account and in what form.
- **The one question:** "Exactly what will be shared, in what form, with whom?"
- **Focal element:** the manifest — a sticky declaration sheet on the right that states the count of tables and columns, a big stamped treatment (CLONE / MASKED / SYNTHETIC), the destination and the recipients, followed by the numbered SQL steps. It updates live as choices change.
- **Direction:** "customs declaration desk": warm paper background, navy ink, one vermilion stamp accent, condensed Archivo display type for headings and the stamp, IBM Plex Mono for identifiers and SQL. Light by default with an ink-dark mode. Deliberately not a dashboard: no stat-card row, no purple gradients, no cards around everything.
- **Signature detail:** the treatment stamp — a rotated, outlined vermilion stamp on the manifest that changes with the method, and a "CLEARED" stamp when the run succeeds.
- **Next step:** review the manifest, press "Run manifest", confirm, then watch each step clear or fail with a plain message and query ID; copy the SQL to run it elsewhere.
- **Trust:** table lists, row counts and column types come from INFORMATION_SCHEMA as the signed-in user (caller's rights). The server rebuilds the SQL from catalog metadata on every preview and run, so the browser never sends SQL. Sensitivity flags are name-based hints, labelled as such.

## What it does

| Section | Choices | SQL it generates |
| --- | --- | --- |
| 01 Pick source data | Any database / schema / table or view your role can see; several at once | — |
| 02 Treatment | **Zero-copy clone** (excluded columns dropped from the clone; views are copied) · **Mask, then copy** (per column: hash, last-4, email user, redact, NULL, round, truncate to month/year; defaults suggested from column names) · **Synthetic data** (join keys, optional privacy filter) | `CREATE TABLE … CLONE`, `CREATE TABLE … AS SELECT …`, `CALL SNOWFLAKE.DATA_PRIVACY.GENERATE_SYNTHETIC_DATA(…)` (batched 5 tables per call; column subsets go through a staging view that is dropped afterwards) |
| 03 Where to store it | Target database, schema, suffix, create-if-missing, replace existing | `CREATE DATABASE/SCHEMA IF NOT EXISTS` |
| 04 How to deliver it | Keep in account · Direct share (+ consumer accounts) · Private listing (targets, draft or publish, cross-region auto-fulfillment) · Organization listing (Internal Marketplace, named accounts or all internal accounts) | `CREATE SHARE`, grants, `ALTER SHARE … ADD ACCOUNTS`, `CREATE EXTERNAL LISTING`, `CREATE ORGANIZATION LISTING` |

Steps run in order and stop at the first failure; each step reports its duration and query ID.

## Code map

- `lib/plan.ts` — the SQL plan builder (pure, unit-tested in `__tests__/lib/plan.test.ts`). All identifiers are quoted, account and object names are validated, listing text is YAML-escaped and may not contain `$$`.
- `lib/spec.ts` — coerces the untrusted request body into a spec.
- `lib/catalog.ts` — catalog queries and friendly error mapping.
- `lib/sensitivity.ts` — name-based PII hints.
- `app/api/{context,catalog,plan,execute}` — routes; all run with caller's rights.
- `components/prep/*` — the UI (sections, manifest panel).

## Run locally

```bash
npm install
npm run dev     # http://localhost:3000
npm test
```

Locally the app uses the default Snowflake CLI connection (`default_connection_name` in `~/.snowflake/config.toml`) and runs as that connection's role. Caller's rights only applies once deployed.

## Deploy

Requires a Snowflake CLI with `snow app` (`snow app setup --help` must work). Then:

```bash
snow app setup --app-name share_prep   # writes snowflake.yml or app.yml v2
snow app deploy --verbose
```

### Caller grants (required once deployed)

Every action runs as the signed-in user, but only within what the app's owning role has been granted as caller grants. An admin with `MANAGE CALLER GRANTS` must grant, to the role that owns the application service, at least:

```sql
GRANT CALLER USAGE ON WAREHOUSE <wh> TO ROLE <app_owner_role>;
GRANT CALLER USAGE ON DATABASE <src_db> TO ROLE <app_owner_role>;     -- repeat for the target database
GRANT INHERITED CALLER USAGE ON ALL SCHEMAS IN DATABASE <src_db> TO ROLE <app_owner_role>;
GRANT INHERITED CALLER SELECT ON ALL TABLES IN DATABASE <src_db> TO ROLE <app_owner_role>;
-- plus the write and sharing privileges you want users to exercise through the app, e.g.
-- CREATE TABLE / CREATE VIEW on the target schema, CREATE SHARE, CREATE LISTING, CREATE ORGANIZATION LISTING.
```

Users also need those privileges themselves; by default only ACCOUNTADMIN can create shares and listings. Synthetic data needs Enterprise Edition and accepted Anaconda terms.

## Known limits

- Masked copies are static snapshots. For data that must stay live, attach masking policies to the source and share a secure view instead.
- Cloned tables carry real values. The manifest flags included columns whose names look sensitive.
- Sensitivity flags are name heuristics, not `SYSTEM$CLASSIFY` results.
- A share can only expose objects from the database it is granted on; keep output in one target database per share.
