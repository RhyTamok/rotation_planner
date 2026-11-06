import { TIME_TOLERANCE } from "./compare";

// Which cutoffs a comparison reports. A stored comparison with no cutoffs of its own uses the
// default grid (spec Q7), which follows the length of the fight. Editing the list stores it.

export const DEFAULT_CUTOFF_STEP = 30;

const sameInstant = (a: number, b: number) => Math.abs(a - b) <= TIME_TOLERANCE;

// Every `step` seconds from the pull, stopping short of the end of the fight, which is always
// reported anyway.
export function defaultCutoffs(endTime: number, step = DEFAULT_CUTOFF_STEP): number[] {
	const times: number[] = [];
	for (let k = 1; k * step < endTime - TIME_TOLERANCE; k++) times.push(k * step);
	return times;
}

// The editable list: the stored cutoffs, or the default grid when there are none.
export function listedCutoffs(stored: number[], endTime: number): number[] {
	return stored.length > 0 ? stored : defaultCutoffs(endTime);
}

// Ascending, with the end of the fight added. Times within TIME_TOLERANCE are one row: the end of
// a fight carries float noise and must not double a cutoff entered by hand.
export function reportedCutoffs(listed: number[], endTime: number): number[] {
	const times: number[] = [];
	for (const t of [...listed, endTime].sort((a, b) => a - b)) {
		if (times.length === 0 || !sameInstant(times[times.length - 1], t)) times.push(t);
	}
	return times;
}

export function isListedCutoff(listed: number[], time: number): boolean {
	return listed.some((t) => sameInstant(t, time));
}

export function withCutoff(listed: number[], time: number): number[] {
	return isListedCutoff(listed, time) ? listed : [...listed, time];
}

export function withoutCutoff(listed: number[], time: number): number[] {
	return listed.filter((t) => !sameInstant(t, time));
}
