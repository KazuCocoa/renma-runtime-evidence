import {
  bindDeploymentSnapshot,
  FIXTURE_NAME,
  resolveDeploymentCandidate,
  type DeploymentSnapshot,
  type FixtureCatalog,
} from "./manifest.js";

type Attribute = {
  readonly key: string;
  readonly value:
    { readonly stringValue: string } | { readonly boolValue: boolean };
};
const textAttribute = (key: string, value: string): Attribute => ({
  key,
  value: { stringValue: value },
});
const boolAttribute = (key: string, value: boolean): Attribute => ({
  key,
  value: { boolValue: value },
});
const EXPERIMENT_VERSION = "renma.experimental-presence-deployment-otlp.v1";

function reducedPresence(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Invalid fixture presence snapshot");
  }
  const value = input as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    value.provider !== "codex" ||
    value.signal !== "skill-injected" ||
    value.observationScope !== "collector-lifetime" ||
    typeof value.unrecognizedSkillObserved !== "boolean" ||
    !Array.isArray(value.injectedSkills) ||
    value.injectedSkills.length > 128 ||
    value.injectedSkills.some((label) => typeof label !== "string")
  ) {
    throw new Error("Invalid fixture presence snapshot");
  }
  return {
    observed: value.injectedSkills.includes(FIXTURE_NAME),
    unknown:
      value.unrecognizedSkillObserved ||
      value.injectedSkills.some((label) => label !== FIXTURE_NAME),
  };
}

/** Experiment only: close over a validated copy before starting the collector.
 * There is deliberately no runtime mode or lookup of the latest sync state.
 */
export function bindFixtureOtelProjection(
  catalog: FixtureCatalog,
  deployment: DeploymentSnapshot,
) {
  if (
    deployment.schemaVersion !== "renma.experimental-deployment-snapshot.v1" ||
    deployment.provenance !== "experiment-wrapper" ||
    deployment.repository !== "renma-runtime-evidence-fixture" ||
    deployment.sourceRevision.verification !== "caller-supplied-unverified"
  ) {
    throw new Error("Invalid fixture deployment provenance");
  }
  const bound = bindDeploymentSnapshot(
    catalog,
    deployment.entries,
    deployment.sourceRevision.commit,
  );
  const candidate = resolveDeploymentCandidate(bound);

  return Object.freeze({
    project(input: unknown) {
      const presence = reducedPresence(input);
      const common = () => [
        textAttribute("renma.experiment.schema", EXPERIMENT_VERSION),
        textAttribute("renma.evidence.class", "synthetic-fixture"),
        textAttribute("renma.record.meaning", "snapshot-not-lifecycle-event"),
      ];
      const providerAttributes = [
        ...common(),
        textAttribute("renma.provenance", "synthetic-provider-projection"),
        textAttribute("renma.provider", "codex"),
        textAttribute("renma.provider.signal", "skill-injected"),
        textAttribute("renma.provider.scope", "collector-lifetime"),
        textAttribute("renma.provider.skill_name", FIXTURE_NAME),
        boolAttribute("renma.provider.presence_observed", presence.observed),
        boolAttribute(
          "renma.provider.unrecognized_label_observed",
          presence.unknown,
        ),
      ];
      const wrapperAttributes = [
        ...common(),
        textAttribute("renma.provenance", "experiment-wrapper"),
        textAttribute("renma.deployment.repository", bound.repository),
        textAttribute(
          "renma.deployment.candidate_resolution",
          presence.observed ? candidate.resolution : "no-provider-presence",
        ),
        textAttribute("renma.deployment.injected_revision", "unsupported"),
      ];
      if (presence.observed && candidate.deployment) {
        wrapperAttributes.push(
          textAttribute(
            "renma.deployment.asset_id",
            candidate.deployment.assetId,
          ),
          textAttribute(
            "renma.deployment.skill_name",
            candidate.deployment.skillName,
          ),
          textAttribute(
            "renma.deployment.content_digest",
            candidate.deployment.contentDigest,
          ),
          textAttribute(
            "renma.deployment.digest_scope",
            candidate.deployment.digestScope,
          ),
          textAttribute(
            "renma.deployment.local_state",
            candidate.deployment.localState,
          ),
          textAttribute(
            "renma.deployment.commit_verification",
            bound.sourceRevision.verification,
          ),
        );
        if (bound.sourceRevision.commit !== null) {
          wrapperAttributes.push(
            textAttribute(
              "renma.deployment.commit",
              bound.sourceRevision.commit,
            ),
          );
        }
      }
      // OTLP/HTTP JSON ExportLogsServiceRequest. These logs represent reduced
      // snapshots; they do not fabricate timestamps, trace IDs or lifecycle events.
      return {
        resourceLogs: [
          {
            scopeLogs: [
              {
                scope: {
                  name: "renma.experiment.provider-presence",
                  version: "1",
                },
                logRecords: [
                  {
                    body: {
                      stringValue: "Synthetic provider presence snapshot",
                    },
                    attributes: providerAttributes,
                  },
                ],
              },
              {
                scope: { name: "renma.experiment.deployment", version: "1" },
                logRecords: [
                  {
                    body: {
                      stringValue: "Bound deployment candidate snapshot",
                    },
                    attributes: wrapperAttributes,
                  },
                ],
              },
            ],
          },
        ],
      };
    },
  });
}
