import { object } from "../../codex-model-freshness/src/contract.js";
import { PLUGIN } from "../../codex-plugin-usage/src/fixture.js";

// No arbitrary config keys, origins, paths, marketplace metadata, or messages survive.
export function reduceConfig(value: unknown) {
  const plugins = object(object(object(value)?.config)?.plugins);
  const enabled = object(plugins?.[`${PLUGIN}@personal`])?.enabled;
  const quoted = object(plugins?.[`"${PLUGIN}@personal"`])?.enabled;
  return {
    pluginEnabled: typeof enabled === "boolean" ? enabled : null,
    literalQuotedPluginEnabled: typeof quoted === "boolean" ? quoted : null,
  };
}

export function reducePlugins(value: unknown) {
  const markets = object(value)?.marketplaces;
  if (!Array.isArray(markets)) throw new Error("Plugin listing unavailable");
  const found = markets.flatMap((market) => {
    const m = object(market);
    return m?.name === "personal" && Array.isArray(m.plugins)
      ? m.plugins.map(object).filter((p) => p?.name === PLUGIN)
      : [];
  });
  const p = found.length === 1 ? found[0] : undefined;
  return {
    entries: found.length,
    installed: typeof p?.installed === "boolean" ? p.installed : null,
    enabled: typeof p?.enabled === "boolean" ? p.enabled : null,
  };
}
