import { describe, expect, it } from "vitest";
import { ConsentService } from "../src/consent/consentService.js";
import { InMemoryConsentRepository } from "./support/inMemoryConsentRepository.js";

const NOW = new Date("2026-09-01T00:00:00.000Z");

describe("ConsentService", () => {
	it("accepts only the current notice and records it idempotently", async () => {
		const repository = new InMemoryConsentRepository();
		const service = new ConsentService({ repository, noticeVersion: "notice-2", noticeText: "当前告知" });

		await expect(service.consent("user-1", "notice-1", "0.1.0", NOW)).rejects.toMatchObject({ code: "consent_required" });
		expect(await service.consent("user-1", "notice-2", "0.1.0", NOW)).toBe(true);
		expect(await service.consent("user-1", "notice-2", "0.1.0", NOW)).toBe(false);
		expect(repository.records).toHaveLength(1);
		await expect(service.assertValidConsent("user-1")).resolves.toBeUndefined();
	});

	it("withdrawal immediately removes Agent eligibility without deleting the record", async () => {
		const repository = new InMemoryConsentRepository();
		const service = new ConsentService({ repository, noticeVersion: "notice-2", noticeText: "当前告知" });
		await service.consent("user-1", "notice-2", "0.1.0", NOW);

		expect(await service.withdraw("user-1", new Date(NOW.getTime() + 1000))).toBe(true);
		await expect(service.assertValidConsent("user-1")).rejects.toMatchObject({ code: "consent_required" });
		expect(repository.records).toHaveLength(1);
		expect(repository.records[0]?.withdrawnAt).toEqual(new Date(NOW.getTime() + 1000));
	});

	it("activating a new notice invalidates older active consent", async () => {
		const repository = new InMemoryConsentRepository();
		const oldService = new ConsentService({ repository, noticeVersion: "notice-1", noticeText: "旧告知" });
		await oldService.consent("user-1", "notice-1", "0.1.0", NOW);
		const currentService = new ConsentService({ repository, noticeVersion: "notice-2", noticeText: "新告知" });

		expect(await currentService.activate(new Date(NOW.getTime() + 1000))).toBe(1);
		await expect(currentService.assertValidConsent("user-1")).rejects.toMatchObject({ code: "consent_required" });
		expect(repository.records[0]?.invalidatedAt).toEqual(new Date(NOW.getTime() + 1000));
	});
});
