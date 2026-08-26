import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createDesktopDevInvocation } from "./dev-desktop.mjs";

test("desktop development starts the component script with Node instead of spawning npm.cmd", () => {
	const repositoryPath = join(process.cwd(), "hydro-repository");
	const nodeExecutable = join(process.cwd(), "node.exe");
	const invocation = createDesktopDevInvocation({
		repositoryPath,
		nodeExecutable,
		environment: {
			ELECTRON_RUN_AS_NODE: "1",
			PATH: "test-path",
		},
	});

	assert.equal(invocation.command, nodeExecutable);
	assert.deepEqual(invocation.args, [join(repositoryPath, "apps", "desktop", "scripts", "dev.js")]);
	assert.equal(invocation.cwd, join(repositoryPath, "apps", "desktop"));
	assert.equal(invocation.env.HYDROZAGENT_PI_CLI_PATH, join(repositoryPath, "packages", "coding-agent", "dist", "cli.js"));
	assert.equal(invocation.env.HYDROZAGENT_NODE_EXECUTABLE, nodeExecutable);
	assert.equal(invocation.env.PATH, "test-path");
	assert.equal(invocation.env.ELECTRON_RUN_AS_NODE, undefined);
});
