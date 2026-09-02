import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const channels = {
	managedStatus: "managed:status",
	managedLogin: "managed:login",
	managedRegister: "managed:register",
	managedNotice: "managed:notice",
	managedConsent: "managed:consent",
	managedWithdraw: "managed:withdraw",
	managedLogout: "managed:logout",
	managedDeactivate: "managed:deactivate",
};

function harness() {
	const handlers = new Map();
	const calls = [];
	const manager = {
		status: () => ({ managed: true }),
		login: async (input, register) => { calls.push({ command: "login", input, register }); },
		currentNotice: async () => ({ notice_version: "v1", text: "notice" }),
		consent: async (input) => { calls.push({ command: "consent", input }); },
		withdraw: async () => undefined,
		logout: async () => undefined,
		deactivate: async () => undefined,
	};
	const { registerManagedIpc } = loadTsCommonJs("src/main/ipc/managedIpc.ts", {
		stubs: {
			"../../shared/ipc": { ipcChannels: channels },
			"../managed/buildManifest": { MANAGED_BUILD: { managed: true } },
		},
	});
	registerManagedIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, manager);
	return { handlers, calls };
}

test("managed IPC accepts only the minimal login and consent envelopes", async () => {
	const { handlers, calls } = harness();
	const login = handlers.get(channels.managedLogin);
	const consent = handlers.get(channels.managedConsent);

	assert.throws(() => login({}, { username: "alice", password: "secret", deviceId: "renderer-spoof" }), /参数无效/);
	assert.throws(() => consent({}, { noticeVersion: "v1", clientVersion: "renderer-spoof" }), /参数无效/);
	assert.equal(calls.length, 0);

	await login({}, { username: "alice", password: "secret" });
	await consent({}, { noticeVersion: "v1" });
	assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
		{ command: "login", input: { username: "alice", password: "secret" }, register: false },
		{ command: "consent", input: { noticeVersion: "v1" } },
	]);
});
