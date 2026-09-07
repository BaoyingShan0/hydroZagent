// Test facility only. Private material stays in an ignored directory, never in distributables.
const { execFileSync } = require("node:child_process");
const { X509Certificate } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(process.argv[2] || path.join(__dirname, "../../..", ".artifacts/hcs-test-pki"));
if (fs.existsSync(root)) throw new Error("Refusing to overwrite existing test PKI; use a new test directory");
fs.mkdirSync(root, { recursive: true, mode: 0o700 });
const openssl = process.env.OPENSSL_EXE || "openssl";
fs.writeFileSync(path.join(root, "openssl.cnf"), "[req]\ndistinguished_name=dn\n[dn]\n");
const run = (args) => execFileSync(openssl, args, { cwd: root, stdio: "pipe", windowsHide: true,
	env: { ...process.env, OPENSSL_CONF: path.join(root, "openssl.cnf") } });
run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "2",
	"-keyout", "ca.key", "-out", "ca.pem", "-subj", "/CN=hydroZagent TEST ONLY CA",
	"-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
run(["req", "-newkey", "rsa:2048", "-nodes", "-sha256", "-keyout", "server.key", "-out", "server.csr",
	"-subj", "/CN=hcs.test.internal"]);
fs.writeFileSync(path.join(root, "server.ext"), "subjectAltName=DNS:hcs.test.internal\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n");
run(["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
	"-out", "server.pem", "-days", "2", "-sha256", "-extfile", "server.ext"]);
const ca = new X509Certificate(fs.readFileSync(path.join(root, "ca.pem")));
fs.writeFileSync(path.join(root, "public-manifest.json"), JSON.stringify({ testOnly: true,
	origin: "https://hcs.test.internal:28787", caFingerprint256: ca.fingerprint256,
	validFrom: ca.validFrom, validTo: ca.validTo }, null, 2));
console.log(`Created temporary TEST ONLY PKI: ${root}`);
