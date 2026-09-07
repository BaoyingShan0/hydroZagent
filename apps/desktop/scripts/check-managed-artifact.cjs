const fs = require("node:fs");
const path = require("node:path");
const { createHash, X509Certificate } = require("node:crypto");
const asar = require("@electron/asar");

const desktopRoot = path.resolve(__dirname, "..");
const releaseRoot = path.resolve(process.argv[2] || path.join(desktopRoot, "release/managed"));
const expectedOrigin = process.env.HYDRO_HCS_BASE_URL;
const expectedCaPath = process.env.HYDRO_HCS_CA_BUNDLE_PATH;
const failures = [];
const runtimeFiles = [];

function fileDigest(file) {
	return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

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
for (const extension of [".exe", ".zip"]) {
	if (!distributables.some((file) => path.basename(file).startsWith("hydroZagent-managed-") && file.endsWith(extension))) {
		fail(`managed ${extension} artifact is missing`);
	}
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
		const mainBundle = asar.extractFile(asarPath, path.join("out", "main", "index.js")).toString("utf8");
		const expectedCa = fs.readFileSync(expectedCaPath, "utf8").trim();
		const expectedCaLiteral = JSON.stringify(expectedCa).slice(1, -1);
		if (!mainBundle.includes(expectedOrigin)) fail("fixed HCS origin is not compiled into the main bundle");
		if (!mainBundle.includes(expectedCaLiteral)) {
			fail("fixed HCS CA bundle is not compiled into the main bundle");
		}
		if (mainBundle.includes("HYDRO_HCS_BASE_URL") || mainBundle.includes("HYDRO_HCS_CA_BUNDLE_PATH")) {
			fail("managed main bundle still contains runtime HCS override hooks");
		}
		if (!mainBundle.includes("受管制品已禁用该功能")) fail("managed IPC fail-closed lock is missing");
		if (!mainBundle.includes("--managed") || !mainBundle.includes("--offline")) {
			fail("managed Pi launch flags are missing");
		}
		if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(mainBundle)) fail("private key leaked into main bundle");
	}
	if (!fs.existsSync(path.join(resources, "pi-runtime", "pi.exe"))) {
		fail("version-locked native Pi executable is missing");
	}
	for (const asset of ["package.json", "theme/dark.json", "theme/light.json", "photon_rs_bg.wasm"]) {
		if (!fs.existsSync(path.join(resources, "pi-runtime", asset))) fail(`required Pi runtime asset is missing: ${asset}`);
	}
	const piSource = path.resolve(desktopRoot, "../../packages/coding-agent/dist");
	for (const asset of ["pi.exe", "package.json", "theme/dark.json", "theme/light.json", "photon_rs_bg.wasm"]) {
		const packaged = path.join(resources, "pi-runtime", asset);
		const source = path.join(piSource, asset);
		if (!fs.existsSync(source) || !fs.existsSync(packaged)) {
			fail(`cannot verify Pi source identity: ${asset}`);
			continue;
		}
		const sha256 = fileDigest(packaged);
		if (sha256 !== fileDigest(source)) fail(`packaged Pi asset differs from current build: ${asset}`);
		runtimeFiles.push({ file: `resources/pi-runtime/${asset}`, sha256 });
	}
	runtimeFiles.push({ file: "resources/app.asar", sha256: fileDigest(asarPath) });
	if (fs.existsSync(path.join(resources, "extensions"))) fail("extension resources leaked into managed artifact");
	if (fs.existsSync(path.join(resources, "xueprompts.db"))) fail("non-Pi prompt database leaked into managed artifact");
}

const files = distributables.map((file) => ({
	file: path.basename(file),
	bytes: fs.statSync(file).size,
	sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
}));
const report = {
	testOnly: true,
	checkedAt: new Date().toISOString(),
	origin: expectedOrigin,
	caFingerprint256: new X509Certificate(fs.readFileSync(expectedCaPath)).fingerprint256,
	passed: failures.length === 0,
	failures,
	files,
	runtimeFiles,
};
fs.writeFileSync(path.join(releaseRoot, "managed-artifact-report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(releaseRoot, "SHA256SUMS.txt"), files.map((file) => `${file.sha256}  ${file.file}`).join("\n") + "\n");

if (failures.length) {
	for (const failure of failures) process.stderr.write(`Managed artifact check failed: ${failure}\n`);
	process.exitCode = 1;
} else {
	process.stdout.write("Managed Windows artifact gate: PASS\n");
}
