const assert = require("node:assert/strict");
const { X509Certificate } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

test("managed build validates real CA certificates and refuses malformed origins and placeholder trust", () => {
	const source = readFileSync(path.join(__dirname, "../../electron.vite.config.ts"), "utf8");
	const start = source.indexOf("function managedBuildDefinitions()");
	const end = source.indexOf("export default defineConfig", start);
	assert.ok(start > 0 && end > start);
	const script = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
	const validPem = readFileSync(path.join(process.env.HCS_TEST_PKI_DIR, "ca.pem"), "utf8");
	const invoke = (origin, pem = validPem) => vm.runInNewContext(`${script}\nmanagedBuildDefinitions()`, {
		process: { env: { HYDRO_MANAGED_BUILD: "1", HYDRO_HCS_BASE_URL: origin, HYDRO_HCS_CA_BUNDLE_PATH: "test.pem" } },
		URL, Date, X509Certificate, resolve: path.resolve, readFileSync: () => pem,
	});
	const result = invoke("https://hcs.test.internal:28787");
	assert.equal(result.__HYDRO_MANAGED__, "true");
	assert.equal(JSON.parse(result.__HYDRO_HCS_CA_BUNDLE__), validPem);
	for (const origin of ["http://hcs.test.internal", "https://localhost", "https://127.0.0.1", "https://hcs.test.internal/path", "https://user:pass@hcs.test.internal"]) {
		assert.throws(() => invoke(origin));
	}
	assert.throws(() => invoke("https://hcs.test.internal", "-----BEGIN CERTIFICATE-----\nplaceholder\n-----END CERTIFICATE-----"));
	assert.throws(() => invoke("https://hcs.test.internal", `${validPem}\n-----BEGIN PRIVATE KEY-----`));
});
