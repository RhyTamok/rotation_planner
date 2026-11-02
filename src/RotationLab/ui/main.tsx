// Must stay the first import. The engine has circular imports (e.g. Resources <-> Jobs/BLM)
// that only initialize correctly in the order the original app loads them, through
// Components/Main. Entering the engine elsewhere (e.g. via GameConfig) makes BLM.ts run before
// Resources.ts finishes: "can't access lexical declaration 'resourceInfos' before
// initialization". Vitest's loader tolerates this, so unit tests cannot catch it.
import "../../Components/Main";

import React from "react";
import { createRoot } from "react-dom/client";

import "./RotationLab.css";
import { RotationLabApp } from "./RotationLabApp";

createRoot(document.getElementById("root") as HTMLDivElement).render(
	<React.StrictMode>
		<RotationLabApp />
	</React.StrictMode>,
);
