import { LISTING_FIXTURE_NAME } from "../../codex-listing-freshness/src/listing.js";
import { barrierDeployment } from "./barrier.js";
import { object } from "./contract.js";

type Attribute = {
  key: string;
  value: { stringValue: string } | { boolValue: boolean };
};
const text = (key: string, value: string): Attribute => ({
  key,
  value: { stringValue: value },
});
const bool = (key: string, value: boolean): Attribute => ({
  key,
  value: { boolValue: value },
});
export const RUNTIME_OTEL_SCHEMA =
  "renma.experimental-codex-runtime-presence.v1";
export type InputEvidence = "real-cli" | "synthetic-test";

/** Fixed experiment vocabulary only; bind after byte verification, before collector creation. */
export function bindRuntimeOtelProjection(
  inputDeployment: unknown,
  inputEvidence: InputEvidence,
) {
  const candidate = object(inputDeployment);
  if (
    !candidate ||
    (candidate.revision !== "a" && candidate.revision !== "b") ||
    (inputEvidence !== "real-cli" && inputEvidence !== "synthetic-test")
  )
    throw new Error("Invalid runtime projection provenance");
  const bound = barrierDeployment(candidate.revision);
  if (
    candidate.provenance !== bound.provenance ||
    candidate.scope !== bound.scope ||
    candidate.digest !== bound.digest
  )
    throw new Error("Invalid runtime projection deployment");
  // Reconstructed from known primitives; never retain the caller's mutable object.
  return Object.freeze({
    project(input: unknown) {
      const value = object(input);
      if (
        !value ||
        value.schemaVersion !== 1 ||
        value.provider !== "codex" ||
        value.signal !== "skill-injected" ||
        value.observationScope !== "collector-lifetime" ||
        typeof value.unrecognizedSkillObserved !== "boolean" ||
        !Array.isArray(value.injectedSkills) ||
        value.injectedSkills.length > 128 ||
        value.injectedSkills.some((label) => typeof label !== "string")
      )
        throw new Error("Invalid runtime presence snapshot");
      const observed = value.injectedSkills.includes(LISTING_FIXTURE_NAME);
      const unknown =
        value.unrecognizedSkillObserved ||
        value.injectedSkills.some((label) => label !== LISTING_FIXTURE_NAME);
      const common = [
        text("renma.experiment.schema", RUNTIME_OTEL_SCHEMA),
        text(
          "renma.evidence.class",
          inputEvidence === "real-cli"
            ? "real-runtime-reduced-snapshot"
            : "synthetic-test",
        ),
        text("renma.record.meaning", "snapshot-not-lifecycle-event"),
        bool("renma.fixture.synthetic_content", true),
      ];
      const provider = [
        text(
          "renma.provenance",
          inputEvidence === "real-cli"
            ? "provider-runtime-reduction"
            : "synthetic-provider-projection",
        ),
        text("renma.provider", "codex"),
        text("renma.provider.signal", "skill-injected"),
        text("renma.provider.scope", "collector-lifetime"),
        text("renma.provider.skill_name", LISTING_FIXTURE_NAME),
        bool("renma.provider.presence_observed", observed),
        bool("renma.provider.unrecognized_label_observed", unknown),
      ];
      const deployment = [
        text("renma.provenance", "experiment-wrapper"),
        text("renma.deployment.binding", "before-collector-start"),
        text(
          "renma.deployment.candidate_resolution",
          observed ? "unique-known-fixture-candidate" : "no-provider-presence",
        ),
        text("renma.deployment.injected_revision", "unsupported"),
      ];
      if (observed)
        deployment.push(
          text("renma.deployment.content_digest", bound.digest),
          text("renma.deployment.digest_scope", bound.scope),
          text("renma.deployment.fixture_revision", bound.revision),
        );
      return {
        resourceLogs: [
          {
            scopeLogs: [
              {
                scope: {
                  name: "renma.experiment.codex-runtime-presence",
                  version: "1",
                },
                logRecords: [
                  {
                    attributes: common,
                    body: {
                      kvlistValue: {
                        values: [
                          {
                            key: "provider",
                            value: { kvlistValue: { values: provider } },
                          },
                          {
                            key: "deployment",
                            value: { kvlistValue: { values: deployment } },
                          },
                        ],
                      },
                    },
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
