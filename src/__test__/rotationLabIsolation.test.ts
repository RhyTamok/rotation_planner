
import { describe, expect, it } from "vitest";
import { GameConfig, DEFAULT_CONFIG } from "../Game/GameConfig";
import { getGameState } from "../Game/Jobs";

describe("Rotation Lab - Viper state isolation", () => {
  function createViperState() {
    const config = new GameConfig({
      ...DEFAULT_CONFIG,
      job: "VPR",
    });

    return getGameState(config);
  }

  it("creates independent GameState instances", () => {
    const a = createViperState();
    const b = createViperState();

    expect(a).not.toBe(b);
    expect(a.resources).not.toBe(b.resources);
    expect(a.cooldowns).not.toBe(b.cooldowns);
    expect(a.debuffs).not.toBe(b.debuffs);
  });

  it("keeps simulation time separate", () => {
    const a = createViperState();
    const b = createViperState();

    expect(a.time).toBe(0);
    expect(b.time).toBe(0);

    // Directly mutate time to test instance isolation.
    // This is not a substitute for testing the actual tick() API.
    a.time = 5;

    expect(a.time).toBe(5);
    expect(b.time).toBe(0);
  });
});
