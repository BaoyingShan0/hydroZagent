export class ConcurrencyGate {
	readonly limit: number;
	private active = 0;

	constructor(limit: number) {
		if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Concurrency limit must be a positive integer");
		this.limit = limit;
	}

	tryAcquire(): (() => void) | null {
		if (this.active >= this.limit) return null;
		this.active += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.active -= 1;
		};
	}
}
