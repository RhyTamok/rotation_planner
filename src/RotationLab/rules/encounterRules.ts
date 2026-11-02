import { ActionKey } from "../../Game/Data";
import { GameState } from "../../Game/GameState";
import { getSkill } from "../../Game/Skills";

// Encounter rules the Rotation Lab enforces on top of XIV in the Shell. Upstream lets damage land
// before the pull and lets targeted actions be used on an untargetable boss; the Lab does not.
// Enabled with SimulationOptions.encounterRules (on for every scenario the editor simulates).
//
// - Pull: the first damaging action starts the fight when it lands, so it is held until its damage
//   lands at exactly 0 s. If it would land after 0 s, the countdown is lengthened instead so the
//   first hit still defines 0 s (see simulateRotation). Non-damaging pre-pull actions (e.g. a
//   tincture at -5 s) are unaffected.
// - Downtime: actions that need an enemy target are invalid while the boss is untargetable.
//   An action pressed before downtime that lands inside it still applies its effects but deals no
//   damage ("ghosting"); the engine already behaves this way.

export const EncounterViolation = {
	NoTarget: "boss is untargetable and this action needs a target",
} as const;

// Damaging actions that hit around the player and need no target, so they stay usable in
// downtime. Vicepit still grants the Den buffs there (VPR.ts withholds its Rattling Coil).
const TARGETLESS_DAMAGE = new Set<ActionKey>(["VICEPIT"]);

// Non-damaging actions that still need an enemy target.
const TARGETED_UTILITY = new Set<ActionKey>(["ARMS_LENGTH", "LEG_SWEEP", "SLITHER"]);

export function isDamaging(game: GameState, action: ActionKey): boolean {
	return (getSkill(game.job, action)?.potencyFn(game) ?? 0) > 0;
}

export function needsTarget(game: GameState, action: ActionKey): boolean {
	if (TARGETED_UTILITY.has(action)) return true;
	return isDamaging(game, action) && !TARGETLESS_DAMAGE.has(action);
}
