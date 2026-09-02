const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const desktopRoot = path.resolve(__dirname, "..");
const releaseRoot = path.resolve(process.argv[2] || path.join(desktopRoot, "release"));
const expectedOrigin = process.env.HYDRO_HCS_BASE_URL;
const expectedCaPath = process.env.HYDRO_HCS_CA_BUNDLE_PATH;
const failures = [];

function fail(message) {
	failures.push(message);
}

if (!fs.existsSync(releaseRoot)) {
	throw new Error(`Managed artifact directory does not exist: ${releaseRoot}`);
}
if (!expectedOrigin || !expectedCaPath) {
	throw new Error("Artifact check requires HYDRO_HCS_BASE_URL and HYDRO_HCS_CA_BUNDLE_PATH");
}

const distributables = fs.readdirSync(releaseRoot, { withFileTypes: true })
	.filter((entry) => entry.isFile() && /\.(?:exe|zip)$/iu.test(entry.name))
	.map((entry) => path.join(releaseRoot, entry.name));
if (!distributables.some((file) => path.basename(file).includes("hydroZagent-managed-"))) {
	fail("managed NSIS/ZIP artifact name is missing");
}
if (distributables.some((file) => !path.basename(file).includes("managed"))) {
	fail("release directory contains a non-managed distributable");
}

const unpackedRoot = [releaseRoot, ...fs.readdirSync(releaseRoot, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => path.join(releaseRoot, entry.name))]
	.find((candidate) => fs.existsSync(path.join(candidate, "resources", "app.asar")));
if (!unpackedRoot) {
	fail("win-unpacked/resources/app.asar is missing");
} else {
	const resources = path.join(unpackedRoot, "resources");
	const asarPath = path.join(resources, "app.asar");
	const packageFiles = asar.listPackage(asarPath).map((file) => file.replaceAll("\\", "/"));
	if (!packageFiles.some((file) => file.endsWith("/out/main/index.js"))) {
		fail("managed main bundle is missing from app.asar");
	} else {
		const mainBundle = asar.extractFile(asarPath, "out/main/index.js").toString("utf8");
		const expectedCa = fs.readFileSync(expectedCaPath, "utf8").trim();
		const expectedCaLiteral = JSON.stringify(expectedCa).slice(1, -1);
		if (!mainBundle.includes(expectedOrigin)) fail("fixed HCS origin is not compiled into the main bundle");
		if (!mainBundle.includes(expectedCaLiteral.slice(0, Math.min(expectedCaLiteral.length, 120)))) {
			fail("fixed HCS CA bundle is not compiled into the main bundle");
		}
		if (mainBundle.includes("HYDRO_HCS_BASE_URL") || mainBundle.includes("HYDRO_HCS_CA_BUNDLE_PATH")) {
			fail("managed main bundle still contains runtime HCS override hooks");
		}
		if (!mainBundle.includes("受管制品已禁用该功能")) fail("managed IPC fail-closed lock is missing");
		if (!mainBundle.includes("--managed") || !mainBundle.includes("--offline")) {
			fail("managed Pi launch flags are missing");
		}
	}
	if (!fs.existsSync(path.join(resources, "pi-runtime", "pi.exe"))) {
		fail("version-locked native Pi executable is missing");
	}
	if (fs.existsSync(path.join(resources, "extensions"))) fail("extension resources leaked into managed artifact");
	if (fs.existsSync(path.join(resources, "xueprompts.db"))) fail("non-Pi prompt database leaked into managed artifact");
}

if (failures.length) {
	for (const failure of failures) process.stderr.write(`Managed artifact check failed: ${failure}\n`);
	process.exitCode = 1;
} else {
	process.stdout.write("Managed Windows artifact gate: PASS\n");
}
