# xivgear cross-check

Produces the reference numbers for `src/__test__/rotationLabXivgearSim.test.ts`: it runs
[xivgear](https://github.com/xiv-gear-planner/gear-planner)'s own Viper sim and writes every action
it used, with the expected damage, to `src/__test__/Asset/xivgear/vpr_100_crosscheck.json`. The
test then replays that action list in the Rotation Lab on the same stats. xivgear's author permits
this reuse.

The fixture is committed, so the test needs neither xivgear nor the network. Regenerate it only on
purpose: after xivgear changes its Viper data or maths, or to change the stats or fight length
(constants at the top of `vpr.gen.ts`).

```bash
# from the repository root; needs the clone at ~/dev/gear-planner/gear-planner (or XIVGEAR_DIR)
npm exec -- vitest run -c tools/xivgear-crosscheck/vitest.config.mts
```

The clone needs no `npm install`: the sim packages have no third-party runtime dependencies, and the
config in this folder maps xivgear's `@xivgear/<package>/<file>` imports straight to its sources.
The fixture records the xivgear commit it came from.

After regenerating, read the diff of the fixture before running the test. A changed number is a
finding to explain (which side changed, and is it right?), never something to paper over by
loosening the test.

Do not set the sim's `cutoffMode` to `strict-gcd`: its rotation loop then never ends.
