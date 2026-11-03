import { ShellJob } from "../../Game/Data/Jobs";
import { currentRuleset, SCHEMA_VERSION } from "../models/Rotation";
import { parseRotationDocument } from "../models/validation";
import { RotationStep } from "../simulation/types";

// Copied rotation steps travel through the system clipboard as JSON, so they can be pasted into
// another rotation, another tab, or shared as text.

const MARKER = "rotationLabSteps";

export function serializeSteps(job: ShellJob, steps: RotationStep[]): string {
	return JSON.stringify({ [MARKER]: 1, job, steps });
}

// Steps from clipboard text, or undefined when the text is not copied Rotation Lab steps.
// Steps are validated like a stored rotation, so a pasted step can never be one the simulator
// would reject; steps copied from another job are refused.
export function parseSteps(text: string, job: ShellJob): RotationStep[] | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (
		typeof raw !== "object" ||
		raw === null ||
		!(MARKER in raw) ||
		(raw as { job?: unknown }).job !== job ||
		!Array.isArray((raw as { steps?: unknown }).steps)
	) {
		return undefined;
	}
	const steps = (raw as unknown as { steps: unknown[] }).steps;
	const check = parseRotationDocument({
		schemaVersion: SCHEMA_VERSION,
		id: "clipboard",
		name: "",
		job,
		ruleset: currentRuleset(),
		targets: [],
		entries: steps.map((step, i) => ({ id: String(i), step })),
		updatedAt: new Date().toISOString(),
	});
	return check.ok && steps.length > 0 ? (steps as RotationStep[]) : undefined;
}
