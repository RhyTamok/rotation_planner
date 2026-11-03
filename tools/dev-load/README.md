# Dev-server page check

Loads the Rotation Lab page from a running Vite dev server in Node, using the browser's native ES
module evaluation order, with a jsdom DOM. It catches module-initialization errors that Vitest
and the production build do not reproduce. One example is the TDZ error from the engine's
circular imports, which leaves the page blank.

```powershell
npm.cmd exec -- vite --port 3100 --strictPort   # in a second terminal / in the background
node tools/dev-load/dev-load.mjs . http://localhost:3100 /src/RotationLab/ui/main.tsx
```

Prints `errors: none` (or the error with its first stack lines) and the start of the rendered
text. Stop the server afterwards.

- `http-loader.mjs`: Node module hooks that resolve and load modules over HTTP.
- `dev-load.mjs`: sets up jsdom and the React refresh preamble that Vite normally injects, then
  imports the entry.
