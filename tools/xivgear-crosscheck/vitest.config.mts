import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Resolves xivgear's workspace imports (`@xivgear/<package>/<file>`) to the sources of a local
// clone, so its sims run without installing or building that repository.
const clone = process.env.XIVGEAR_DIR ?? join(homedir(), "dev/gear-planner/gear-planner");

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@xivgear\/([a-z-]+)\/(.*)$/,
				replacement: join(clone, "packages/$1/src/$2.ts"),
			},
		],
	},
	test: {
		environment: "node",
		include: ["tools/xivgear-crosscheck/*.gen.ts"],
		server: { deps: { inline: [/gear-planner/] } },
	},
});
