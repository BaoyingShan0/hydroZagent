import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { managedAssistantFinal } = loadTsCommonJs("src/main/managed/usageProjection.ts");

test("managed usage captures only the latest assistant final from the current turn", () => {
  const messages = [
    { role: "user", text: "historical user" },
    { role: "assistant", text: "historical answer must not be reused" },
    { role: "user", text: "current user" },
    { role: "tool", text: "tool details are excluded" },
    { role: "assistant", text: "draft final" },
    { role: "assistant", text: "authoritative final" },
  ];
  assert.equal(managedAssistantFinal(messages, 2, "completed"), "authoritative final");
  assert.equal(managedAssistantFinal(messages, 2, "aborted"), null);
  assert.equal(managedAssistantFinal(messages, 2, "error"), null);
});

test("managed usage reports null when the current turn has no assistant final", () => {
  const messages = [
    { role: "assistant", text: "old answer" },
    { role: "user", text: "new turn" },
    { role: "tool", text: "tool-only completion" },
  ];
  assert.equal(managedAssistantFinal(messages, 1, "completed"), null);
});

test("managed usage keeps exact visible input and excludes host-only prompt augmentation", () => {
	const source = readFileSync("src/main/pi/AgentManager.ts", "utf8");
	assert.match(source, /userInput:\s*input\.message/);
	assert.doesNotMatch(source, /userInput:\s*(?:trimmed|agentMessage)/);
});
