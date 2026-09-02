const IMMUTABLE_MANAGED_SETTING = /(?:customPi|wsl|webService|dsh|feishu|vision|imagegen|piRpc|piProxy|desktopProxy|defaultAgentBackend|gitCommitMessage(?:Provider|Model)|telemetry)/iu;

/**
 * Managed builds may still persist presentation preferences, but settings that
 * can replace the runtime, select an external model path, or enable another
 * network channel are owned by the build and main process.
 */
export function isManagedSettingImmutable(key: string): boolean {
	return IMMUTABLE_MANAGED_SETTING.test(key);
}
