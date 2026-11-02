import { ShellJob } from "../../Game/Data/Jobs";
import { createGearSet, GearSetDocument, GearStats } from "../models/GearSet";

// Gear set import from xivgear.app links (set, sheet or BiS). xivgear's public API computes the
// stats, so nothing here re-implements gear, materia or food maths. Upstream XIV in the Shell
// imports from the same API (Components/PlaybackControl.tsx); this version uses the current
// endpoint form and imports every set of a sheet.

const API = "https://api.xivgear.app/fulldata";

export function isXivgearLink(text: string): boolean {
	try {
		const host = new URL(text.trim()).hostname;
		return host === "xivgear.app" || host.endsWith(".xivgear.app");
	} catch {
		return false;
	}
}

// The API resolves any xivgear link itself (path-style /sl/<id>, ?page=..., sheets and BiS).
export function fullDataUrl(link: string): string {
	return `${API}?url=${encodeURIComponent(link.trim())}`;
}

export interface XivgearImport {
	gearSets: GearSetDocument[];
	// Non-fatal notes for the user, e.g. a level that differs from the scenario.
	warnings: string[];
	sheetName?: string;
	level?: number;
}

type Obj = Record<string, unknown>;
const isObject = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): number | undefined =>
	typeof x === "number" && Number.isFinite(x) ? x : undefined;

const MAIN_STATS = ["strength", "dexterity", "intelligence", "mind"];

// Converts a /fulldata response into gear sets for `job`, one per set (separators skipped).
// - Substats and weapon damage/delay come from computedStats, which include food.
// - The main stat comes from gearStats: before party bonus and medicine, which the Lab applies
//   itself from the scenario. As upstream, the highest main stat is taken as the job's.
export function parseFullData(body: unknown, job: ShellJob): XivgearImport {
	if (!isObject(body) || !Array.isArray(body.sets)) {
		throw new Error("xivgear returned data in an unexpected format");
	}
	if (body.job !== job) {
		throw new Error(
			`This xivgear ${body.sets.length > 1 ? "sheet" : "set"} is for ${String(body.job)}, not ${job}`,
		);
	}
	const warnings: string[] = [];
	const gearSets: GearSetDocument[] = [];
	body.sets.forEach((set, i) => {
		if (!isObject(set) || set.isSeparator) return;
		const name =
			typeof set.name === "string" && set.name.trim() ? set.name.trim() : `Set ${i + 1}`;
		const stats = set.computedStats;
		const gear = isObject(stats) ? stats.gearStats : undefined;
		if (!isObject(stats) || !isObject(gear)) {
			warnings.push(`"${name}" has no computed stats and was skipped`);
			return;
		}
		const main = Math.max(...MAIN_STATS.map((key) => num(gear[key]) ?? 0));
		const values: GearStats = {
			main,
			wd: num(stats.wdPhys),
			criticalHit: num(stats.crit),
			directHit: num(stats.dhit),
			determination: num(stats.determination),
			skillSpeed: num(stats.skillspeed),
			tenacity: num(stats.tenacity),
		};
		const missing = Object.entries(values).filter(([, v]) => v === undefined || v <= 0);
		if (missing.length > 0) {
			warnings.push(
				`"${name}" is missing ${missing.map(([k]) => k).join(", ")} and was skipped`,
			);
			return;
		}
		const weaponDelay = num(stats.weaponDelay);
		gearSets.push(
			createGearSet({
				job,
				name,
				stats: values,
				weaponDelay: weaponDelay !== undefined && weaponDelay > 0 ? weaponDelay : undefined,
			}),
		);
	});
	if (gearSets.length === 0) {
		throw new Error("The link contains no gear sets that could be imported");
	}
	return {
		gearSets,
		warnings,
		sheetName: typeof body.name === "string" ? body.name : undefined,
		level: num(body.level),
	};
}

export async function importFromXivgear(
	link: string,
	job: ShellJob,
	fetchFn: typeof fetch = fetch,
): Promise<XivgearImport> {
	if (!isXivgearLink(link)) {
		throw new Error("Paste a link from xivgear.app (a set, a sheet or a BiS page)");
	}
	let response: Response;
	try {
		response = await fetchFn(fullDataUrl(link), { headers: { Accept: "application/json" } });
	} catch {
		throw new Error("Could not reach xivgear (check your internet connection)");
	}
	if (!response.ok) {
		throw new Error(
			response.status === 404
				? "xivgear could not find that set or sheet (check the link)"
				: `xivgear returned an error (${response.status})`,
		);
	}
	return parseFullData(await response.json(), job);
}
