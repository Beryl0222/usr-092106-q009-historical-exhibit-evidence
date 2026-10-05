import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const vocabPath = fileURLToPath(new URL("../contracts/vocabularies.json", import.meta.url));
const vocab = JSON.parse(readFileSync(vocabPath, "utf8"));

function enumValues(key) {
  return vocab.$defs[key].enum;
}

export const EVENT_TYPES = enumValues("eventTypes");
export const AGGREGATE_TYPES = enumValues("aggregateTypes");
export const FACT_CLASSES = enumValues("factClass");
export const PRESENTATION_CLASSES = enumValues("presentationClass");
export const TEMPORAL_CERTAINTIES = enumValues("temporalCertainty");
export const EVIDENCE_SUPPORTS = enumValues("evidenceSupport");
export const REVIEW_VERDICTS = enumValues("reviewVerdict");
export const SOURCE_KINDS = enumValues("sourceKind");
export const ACCESS_CLASSES = enumValues("accessClass");
export const CARRIER_KINDS = enumValues("carrierKind");
export const CARRIER_DECISIONS = enumValues("carrierDecision");
export const ISSUE_SEVERITIES = enumValues("issueSeverity");
export const ROLES = enumValues("roles");

const labels = (key) => vocab.$defs[key]["x-labels-zh"] ?? {};

export const FACT_CLASS_ZH = labels("factClass");
export const PRESENTATION_CLASS_ZH = labels("presentationClass");
export const SOURCE_KIND_ZH = labels("sourceKind");
export const ACCESS_CLASS_ZH = labels("accessClass");
export const CARRIER_KIND_ZH = labels("carrierKind");
export const CARRIER_DECISION_ZH = labels("carrierDecision");
