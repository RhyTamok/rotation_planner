import { ACTIONS, ActionKey } from "../../Game/Data";
import { ShellJob } from "../../Game/Data/Jobs";
import { jobHasSkill } from "../../Game/Skills";
import { RotationStep } from "../simulation/types";

// A rotation from a text file: one displayed skill name per line, or a CSV with a skill column
// (roadmap M8a). Only the order of the skills is read. The simulator works out all timing, so
// other columns, such as times or targets, are ignored and named in the result.

export const MAX_LIST_BYTES = 1_000_000;
export const MAX_LIST_STEPS = 5000;

const SKILL_COLUMNS = ["skill_name", "skill", "action"];

export type RotationListResult =
	| { ok: true; steps: RotationStep[]; ignoredColumns: string[] }
	| { ok: false; errors: string[] };

const normalize = (name: string) => name.trim().toLowerCase().replace(/[’`]/g, "'");

// Fields of one line, split on commas, semicolons or tabs. Double quotes protect separators, and
// a doubled quote inside them is a literal quote (RFC 4180).
function fieldsOf(line: string): string[] {
	const fields: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quoted) {
			if (c !== '"') field += c;
			else if (line[i + 1] === '"') field += line[++i];
			else quoted = false;
		} else if (c === '"') quoted = true;
		else if (c === "," || c === ";" || c === "\t") {
			fields.push(field);
			field = "";
		} else field += c;
	}
	fields.push(field);
	return fields.map((f) => f.trim());
}

// Displayed name to action, for the job. A name shared by two of its actions maps to neither.
function skillsByName(job: ShellJob): Map<string, ActionKey | undefined> {
	const names = new Map<string, ActionKey | undefined>();
	for (const key of Object.keys(ACTIONS) as ActionKey[]) {
		if (!jobHasSkill(job, key)) continue;
		const name = normalize(ACTIONS[key].name);
		names.set(name, names.has(name) ? undefined : key);
	}
	return names;
}

// All or nothing: one unknown name rejects the file, so a typo can never leave a rotation that
// silently misses a skill. Whether the sequence is playable is the simulator's to report.
export function parseRotationList(text: string, job: ShellJob): RotationListResult {
	const rows = text
		.split(/\r?\n/)
		.map((line, i) => ({ number: i + 1, line: line.trim() }))
		.filter(({ line }) => line !== "" && !line.startsWith("#"));

	let column = 0;
	let ignoredColumns: string[] = [];
	if (rows.length > 0) {
		const header = fieldsOf(rows[0].line).map((f) => f.toLowerCase());
		const found = header.findIndex((f) => SKILL_COLUMNS.includes(f));
		if (found >= 0) {
			column = found;
			ignoredColumns = fieldsOf(rows[0].line).filter((_, i) => i !== found);
			rows.shift();
		}
	}
	if (rows.length === 0) return { ok: false, errors: ["The file lists no skills."] };
	if (rows.length > MAX_LIST_STEPS) {
		return {
			ok: false,
			errors: [`The file lists ${rows.length} skills; the limit is ${MAX_LIST_STEPS}.`],
		};
	}

	const skills = skillsByName(job);
	const steps: RotationStep[] = [];
	const errors: string[] = [];
	for (const { number, line } of rows) {
		const name = fieldsOf(line)[column] ?? "";
		const action = skills.get(normalize(name));
		if (name === "") errors.push(`Line ${number}: no skill name.`);
		else if (action) steps.push({ type: "skill", action });
		else if (skills.has(normalize(name))) {
			errors.push(`Line ${number}: "${name}" is ambiguous for ${job}.`);
		} else errors.push(`Line ${number}: "${name}" is not a ${job} skill.`);
	}
	return errors.length > 0 ? { ok: false, errors } : { ok: true, steps, ignoredColumns };
}
