import type { Libp2p } from "libp2p";
import type { Services } from "..";
import type { Transaction } from "../schema";
import type { TransactionManager } from "./transactionManager";

interface ActiveConsume {
	score: number;
	timestamp: number;
	timeoutId: NodeJS.Timeout;
}

export class ResourceManager {
	libp2p: Libp2p<Services>;
	companionId: string;
	activeConsumes: Map<string, ActiveConsume>;
	transactionManager: TransactionManager;

	constructor(
		libp2p: Libp2p<Services>,
		companionId: string,
		transactionManager: TransactionManager,
	) {
		this.libp2p = libp2p;
		this.companionId = companionId;
		this.activeConsumes = new Map();
		this.transactionManager = transactionManager;
	}

	consume(score: number): string {
		const consumeId = `${this.companionId}_${Date.now()}`;
		const transaction: Transaction = {
			type: "CONSUME",
			score,
			companionId: this.companionId,
		};

		this.transactionManager.addTransaction(transaction);

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

		this.transactionManager.addTransaction(transaction);

		const payload = new TextEncoder().encode(JSON.stringify(transaction));
		this.libp2p.services.pubsub.publish("transaction", payload);
	}
}
