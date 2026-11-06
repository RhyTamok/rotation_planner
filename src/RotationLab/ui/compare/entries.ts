import { RotationDocument } from "../../models/Rotation";
import { RotationResult } from "../../simulation/types";

// One configuration as the view shows it. Its letter, colour and line pattern come from its place
// in the document, so they stay put when the baseline changes.
export interface ConfigEntry {
	id: string;
	letter: string;
	// Stroke class, carrying the colour and the line pattern (RotationLab.css).
	seriesClass: string;
	// "A: Rotation name"
	label: string;
	rotation?: RotationDocument;
	result?: RotationResult;
	error?: string;
}

export type SimulatedEntry = ConfigEntry & { result: RotationResult };

const LETTERS = ["A", "B", "C", "D"];

export function slotOf(index: number): { letter: string; seriesClass: string } {
	const letter = LETTERS[index];
	return { letter, seriesClass: `rl-series-${letter.toLowerCase()}` };
}
