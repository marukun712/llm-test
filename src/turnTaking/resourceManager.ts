import type { Libp2p } from "libp2p";
import type { Services } from "..";
import type { Transaction } from "../schema";
import type { MerkleTreeManager } from "./merkleTreeManager";

interface ActiveConsume {
	score: number;
	timestamp: number;
	timeoutId: NodeJS.Timeout;
}

export class ResourceManager {
	libp2p: Libp2p<Services>;
	companionId: string;
	activeConsumes: Map<string, ActiveConsume>;
	merkleTreeManager: MerkleTreeManager;

	constructor(
		libp2p: Libp2p<Services>,
		companionId: string,
		merkleTreeManager: MerkleTreeManager,
	) {
		this.libp2p = libp2p;
		this.companionId = companionId;
		this.activeConsumes = new Map();
		this.merkleTreeManager = merkleTreeManager;
	}

	consume(score: number): string {
		const consumeId = `${this.companionId}_${Date.now()}`;
		const transaction: Transaction = {
			type: "CONSUME",
			score,
			companionId: this.companionId,
		};

		this.merkleTreeManager.addTransaction(transaction);

		const payload = new TextEncoder().encode(JSON.stringify(transaction));
		this.libp2p.services.pubsub.publish("transaction", payload);

		//タイムアウト管理(5-10秒でランダム)
		const timeoutMs = 5000 + Math.random() * 5000;
		const timeoutId = setTimeout(() => {
			this.release(score);
			this.activeConsumes.delete(consumeId);
		}, timeoutMs);

		this.activeConsumes.set(consumeId, {
			score,
			timestamp: Date.now(),
			timeoutId,
		});

		return consumeId;
	}

	release(score: number) {
		const transaction: Transaction = {
			type: "RELEASE",
			score,
			companionId: this.companionId,
		};

		this.merkleTreeManager.addTransaction(transaction);

		const payload = new TextEncoder().encode(JSON.stringify(transaction));
		this.libp2p.services.pubsub.publish("transaction", payload);
	}

	cancelConsume(consumeId: string) {
		const active = this.activeConsumes.get(consumeId);
		if (active) {
			clearTimeout(active.timeoutId);
			this.activeConsumes.delete(consumeId);
		}
	}
}
