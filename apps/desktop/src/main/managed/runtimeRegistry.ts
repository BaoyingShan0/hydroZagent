import type { ConfigureManagedProviderCommand } from "../../shared/hcsContracts.generated";

export interface ManagedRuntimeLease {
	readonly runtimeId: string;
	readonly sessionId: string;
	configuration(): ConfigureManagedProviderCommand;
	beginTurn(turnId: string): void;
	finishTurn(turnId: string): string[];
	close(): Promise<void>;
}

export interface ManagedRuntimeFactory {
	create(sessionId: string): Promise<ManagedRuntimeLease>;
}
