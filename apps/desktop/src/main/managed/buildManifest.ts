export type ManagedBuildManifest = {
	managed: boolean;
	hcsBaseUrl: string;
	caBundle: string;
};

export const MANAGED_BUILD: Readonly<ManagedBuildManifest> = Object.freeze({
	managed: __HYDRO_MANAGED__,
	hcsBaseUrl: __HYDRO_HCS_BASE_URL__,
	caBundle: __HYDRO_HCS_CA_BUNDLE__,
});

export function assertManagedBuildManifest(): void {
	if (!MANAGED_BUILD.managed) return;
	const url = new URL(MANAGED_BUILD.hcsBaseUrl);
	if (url.protocol !== "https:" || url.origin !== MANAGED_BUILD.hcsBaseUrl || !MANAGED_BUILD.caBundle.includes("BEGIN CERTIFICATE")) {
		throw new Error("受管构建信任清单无效");
	}
}
