# Renma identity through packaging changes

Run `npm run build`, then:

```sh
node .build/experiments/renma-telemetry-identity/src/run.js --renma-cli /absolute/path/to/renma/dist/index.js
```

The runner uses the actual local Renma CLI against two owned temporary Git repositories. Renma catalogs their Skills; a separate wrapper copies exact bytes into bundle directories and creates deployment-specific identity mappings. Renma itself does not bundle assets. Raw catalog reports are reduced before persistence; only known fixture identity/path/hash predicates, version, commits and declared mapping fields survive.

The saved Renma 0.39.2 report verifies both initial and updated repositories with catalog exit 0, matching explicit ID and content hash, and byte-identical packaged copies. Alpha changes its `name:`, source path, plugin, version and content while retaining `skill.fixture-alpha`. Beta remains in its plugin with a new version/content. Duplicate names in the same plugin/deployment are rejected before a mapping can select an asset. Lookups require a frozen deployment: an old label is not silently resolved against today's manifest.

## Correction to the earlier synthetic fixture

Canonical Renma metadata uses a dotted **string key**:

```yaml
metadata:
  renma.id: skill.fixture-alpha
```

The earlier synthetic Skill used nested `metadata: { renma: { id: ... } }`. Actual Renma 0.39.2 did **not** recognize that as the explicit asset ID. Historical usage reports remain valid as manually assigned wrapper mappings; they did not establish Renma metadata extraction. The new report does establish extraction via the actual catalog for the canonical form.

## Runtime boundary still to verify

The labels in this manifest experiment are **candidates constructed by the packaging wrapper**, based on the label shape seen in earlier actual Codex runs. This experiment has not yet installed the renamed/moved bundles and observed their live Codex labels. That remaining integration check is tracked in the follow-up ledger. Even after such a check, a label cannot prove injected file revision; old/new versions using the same name require external deployment binding. An asset ID must be governed for uniqueness across repositories if it is to be used as a global portfolio identity.
