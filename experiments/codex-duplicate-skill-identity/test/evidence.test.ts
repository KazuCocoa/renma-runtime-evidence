import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listing,
  metricProjection,
  diagnosticProjection,
  observer,
  type Asset,
} from "../src/evidence.js";
const assets: Asset[] = [
  {
    alias: "A",
    name: "code-review",
    path: "/fixture/a/SKILL.md",
    description: "fixture A",
  },
  {
    alias: "B",
    name: "code-review",
    path: "/fixture/b/SKILL.md",
    description: "fixture B",
  },
];
function metrics(label: string) {
  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [{ key: "private", value: { stringValue: "SECRET" } }],
        },
        scopeMetrics: [
          {
            scope: { name: "ignored", version: "SECRET" },
            metrics: [
              {
                name: "codex.skill.injected",
                sum: {
                  dataPoints: [
                    {
                      asInt: "2",
                      attributes: [
                        { key: "skill", value: { stringValue: label } },
                        { key: "status", value: { stringValue: "ok" } },
                        { key: "private", value: { stringValue: "SECRET" } },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
test("duplicate name never resolves a counter to one asset", () => {
  const p = metricProjection(metrics("code-review"), assets) as {
    matchingAssets: string[];
  }[];
  assert.deepEqual(p[0]!.matchingAssets, ["A", "B"]);
  assert.ok(!JSON.stringify(p).includes("SECRET"));
});
test("plugin-qualified labels resolve only against exact static mapping", () => {
  const mapped = assets.map((a, i) => ({
    ...a,
    name: `plugin-${i}:code-review`,
  }));
  const p = metricProjection(metrics("plugin-1_code-review"), mapped) as {
    matchingAssets: string[];
  }[];
  assert.deepEqual(p[0]!.matchingAssets, ["B"]);
  assert.ok(
    !JSON.stringify(metricProjection(metrics("SECRET"), assets)).includes(
      "SECRET",
    ),
  );
});
test("discovery retains known match predicates, no descriptions or paths", () => {
  const p = listing(
    {
      data: [
        {
          skills: assets.map((a) => ({
            name: a.name,
            path: a.path,
            description: a.description,
            enabled: true,
            content: "SECRET",
            id: "SECRET",
          })),
        },
      ],
    },
    assets,
  );
  assert.ok(
    p.every((r) => r.matches === 1 && r.nameMatches && r.descriptionMatches),
  );
  assert.ok(!JSON.stringify(p).includes("/fixture"));
  assert.ok(!JSON.stringify(p).includes("SECRET"));
});
test("notifications discard commands, body, IDs, and tool output", () => {
  const o = observer(assets);
  o.observe({
    method: "item/completed",
    params: {
      item: {
        type: "commandExecution",
        id: "SECRET",
        command: "SECRET",
        aggregatedOutput: "SECRET",
      },
    },
  });
  o.observe({ method: "SECRET", params: { item: { type: "SECRET" } } });
  assert.equal(o.events.length, 1);
  assert.ok(!JSON.stringify(o.events).includes("SECRET"));
});
test("diagnostic projection keeps finite field presence and exact fixture matches only", () => {
  const p = diagnosticProjection(
    {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  body: { stringValue: "SECRET" },
                  attributes: [
                    { key: "path", value: { stringValue: assets[1]!.path } },
                    { key: "private", value: { stringValue: "SECRET" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    assets,
  );
  assert.deepEqual(p, [
    {
      channel: "logs",
      attributeFields: ["path"],
      knownPathAssets: ["B"],
      knownNameAssets: [],
      ignoredAttributeCount: 1,
    },
  ]);
  assert.ok(!JSON.stringify(p).includes("SECRET"));
});

test("malformed duplicate skill attributes do not choose an arbitrary identity", () => {
  const v = metrics("code-review");
  v.resourceMetrics[0]!.scopeMetrics[0]!.metrics[0]!.sum.dataPoints[0]!.attributes.push(
    { key: "skill", value: { stringValue: "SECRET" } },
  );
  const p = metricProjection(v, assets) as {
    providerLabel: string;
    matchingAssets: string[];
  }[];
  assert.equal(p[0]!.providerLabel, "unrecognized");
  assert.deepEqual(p[0]!.matchingAssets, []);
});
