import { ShellJob } from "../../Game/Data/Jobs";
import { newId, SCHEMA_VERSION } from "./Rotation";
import { BurstWindow } from "./Scenario";

// A stored comparison: 1–4 configurations under one shared scenario, measured against a baseline.
// With one entry only its own figures show; everything relative to a baseline needs two (roadmap
// decision C3). See docs/comparison/COMPARISON_SPEC.md. Configurations refer to live rotations
// (each rotation brings its own gear and targets); frozen copies come with snapshots (roadmap M7).

export const MIN_CONFIGURATIONS = 1;
export const MAX_CONFIGURATIONS = 4;
export const DEFAULT_CHARTS_FROM = 10;

export interface ComparisonConfiguration {
	// Unique within the comparison. The same rotation may appear twice, each with its own id.
	id: string;
	rotationId: string;
}

// Presentation only: never an input to a simulation.
export interface ComparisonDisplay {
	// Where the charts start, in seconds from the pull; missing = DEFAULT_CHARTS_FROM.
	chartsFrom?: number;
}

export interface ComparisonDocument {
	schemaVersion: number;
	id: string;
	name: string;
	// Bumped by every edit, so a later snapshot can tell which state it was taken from (M7).
	revision: number;
	job: ShellJob;
	scenarioId: string;
	configurations: ComparisonConfiguration[];
	// The id of one of the configurations.
	baselineId: string;
	// Seconds from the pull. Empty means the default grid (comparison/cutoffs.ts). The end of the
	// fight is always reported in addition to these.
	cutoffs: number[];
	// Not read yet: the view still uses the scenario's windows until roadmap M5 moves them here.
	burstWindows?: BurstWindow[];
	display: ComparisonDisplay;
	updatedAt: string;
}

// The first rotation becomes the baseline.
export function createComparison(props: {
	name?: string;
	job: ShellJob;
	scenarioId: string;
	rotationIds: string[];
}): ComparisonDocument {
	const configurations = props.rotationIds.map((rotationId) => ({ id: newId(), rotationId }));
	return {
		schemaVersion: SCHEMA_VERSION,
		id: newId(),
		name: props.name ?? "Comparison",
		revision: 1,
		job: props.job,
		scenarioId: props.scenarioId,
		configurations,
		baselineId: configurations[0]?.id ?? "",
		cutoffs: [],
		display: {},
		updatedAt: new Date().toISOString(),
	};
}

export function editComparison(
	doc: ComparisonDocument,
	patch: Partial<
		Pick<
			ComparisonDocument,
			"name" | "scenarioId" | "configurations" | "baselineId" | "cutoffs"
		>
	> & { display?: ComparisonDisplay },
): ComparisonDocument {
	return {
		...doc,
		...patch,
		revision: doc.revision + 1,
		updatedAt: new Date().toISOString(),
	};
}

export function addConfiguration(doc: ComparisonDocument, rotationId: string): ComparisonDocument {
	return editComparison(doc, {
		configurations: [...doc.configurations, { id: newId(), rotationId }],
	});
}

// Keeps the configurations that pass, moving the baseline to the first one left if it went.
function keepConfigurations(
	doc: ComparisonDocument,
	keep: (c: ComparisonConfiguration) => boolean,
): ComparisonDocument {
	const configurations = doc.configurations.filter(keep);
	const baselineId = configurations.some((c) => c.id === doc.baselineId)
		? doc.baselineId
		: (configurations[0]?.id ?? "");
	return editComparison(doc, { configurations, baselineId });
}

export function removeConfiguration(doc: ComparisonDocument, id: string): ComparisonDocument {
	return keepConfigurations(doc, (c) => c.id !== id);
}

// The comparisons as they stand once a rotation is gone. A comparison left with fewer than
// MIN_CONFIGURATIONS is no longer valid and is dropped. Unaffected documents are returned as is.
export function removeRotationFromComparisons(
	comparisons: ComparisonDocument[],
	rotationId: string,
): ComparisonDocument[] {
	return comparisons.flatMap((doc) => {
		if (doc.configurations.every((c) => c.rotationId !== rotationId)) return [doc];
		const next = keepConfigurations(doc, (c) => c.rotationId !== rotationId);
		return next.configurations.length < MIN_CONFIGURATIONS ? [] : [next];
	});
}
