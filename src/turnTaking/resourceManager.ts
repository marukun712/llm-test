import type { Libp2p } from "libp2p";
import type { Services } from "..";
import type { Transaction } from "../schema";

export class ResourceManager {
	libp2p: Libp2p<Services>;

	constructor(libp2p: Libp2p<Services>) {
		this.libp2p = libp2p;
	}

	consume(score: number) {
		const transaction: Transaction = {
			type: "CONSUME",
			score,
		};
		const payload = new TextEncoder().encode(JSON.stringify(transaction));
		this.libp2p.services.pubsub.publish("transaction", payload);
	}

	release(score: number) {
		const transaction: Transaction = {
			type: "RELEASE",
			score,
		};
		const payload = new TextEncoder().encode(JSON.stringify(transaction));
		this.libp2p.services.pubsub.publish("transaction", payload);
	}
}
