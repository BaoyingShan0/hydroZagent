import type { ManagedAuthManager } from "./authManager";
import type { ManagedCatalogService } from "./catalogService";
import { ManagedLoopbackLease } from "./loopbackProxy";
import type { ManagedRuntimeFactory, ManagedRuntimeLease } from "./runtimeRegistry";
import { MANAGED_BUILD } from "./buildManifest";

export class DefaultManagedRuntimeFactory implements ManagedRuntimeFactory {
	private readonly auth: ManagedAuthManager;
	private readonly catalog: ManagedCatalogService;

	constructor(auth: ManagedAuthManager, catalog: ManagedCatalogService) {
		this.auth = auth;
		this.catalog = catalog;
	}

	async create(sessionId: string): Promise<ManagedRuntimeLease> {
		const access = this.auth.status();
		if (!access.authenticated || access.consent !== "valid") {
			throw new Error("受管账号未登录或尚未完成知情同意");
		}
		const catalog = await this.catalog.getCurrent();
		const lease = new ManagedLoopbackLease({
			sessionId,
			auth: this.auth,
			catalogVersion: catalog.catalog_version,
			models: catalog.models,
			hcsBaseUrl: MANAGED_BUILD.hcsBaseUrl,
			caBundle: MANAGED_BUILD.caBundle,
		});
		await lease.start();
		return lease;
	}
}
