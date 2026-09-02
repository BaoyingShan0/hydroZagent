export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type RateBucket = {
	timestamps: number[];
	lastSeen: number;
};

/** Single-node fixed-window limiter with bounded memory and deterministic retry hints. */
export class InMemoryRateLimiter {
	readonly limit: number;
	readonly windowMilliseconds: number;
	readonly maximumBuckets: number;
	private readonly buckets = new Map<string, RateBucket>();

	constructor(limit: number, windowSeconds: number, maximumBuckets = 10_000) {
		if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
			throw new Error("Invalid rate limit policy");
		}
		this.limit = limit;
		this.windowMilliseconds = windowSeconds * 1000;
		this.maximumBuckets = maximumBuckets;
	}

	consume(key: string, now: Date): RateLimitDecision {
		const nowMilliseconds = now.getTime();
		const cutoff = nowMilliseconds - this.windowMilliseconds;
		const bucket = this.buckets.get(key) ?? { timestamps: [], lastSeen: nowMilliseconds };
		bucket.timestamps = bucket.timestamps.filter((timestamp) => timestamp > cutoff);
		bucket.lastSeen = nowMilliseconds;
		if (bucket.timestamps.length >= this.limit) {
			this.buckets.set(key, bucket);
			const oldest = bucket.timestamps[0] ?? nowMilliseconds;
			return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMilliseconds - nowMilliseconds) / 1000)) };
		}
		bucket.timestamps.push(nowMilliseconds);
		this.buckets.set(key, bucket);
		this.prune(cutoff);
		return { allowed: true };
	}

	private prune(cutoff: number): void {
		if (this.buckets.size <= this.maximumBuckets) return;
		for (const [key, bucket] of this.buckets) {
			if (bucket.lastSeen <= cutoff) this.buckets.delete(key);
			if (this.buckets.size <= this.maximumBuckets) return;
		}
		const oldest = [...this.buckets.entries()].sort((left, right) => left[1].lastSeen - right[1].lastSeen);
		for (const [key] of oldest.slice(0, this.buckets.size - this.maximumBuckets)) this.buckets.delete(key);
	}
}
