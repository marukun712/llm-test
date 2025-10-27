import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import type { Message } from "@libp2p/interface";
import { mdns } from "@libp2p/mdns";
import { tcp } from "@libp2p/tcp";
import { createLibp2p, type Libp2p } from "libp2p";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import { Chain } from "./src/chain/chain";
import { createTransaction } from "./src/chain/transaction";
import type { Services } from "./src/index";
import {
	broadcastTransaction,
	TRANSACTION_TOPIC,
} from "./src/libp2p/chain-protocol";

export class Firehose {
	libp2p!: Libp2p<Services>;
	wss: WebSocketServer;
	clients = new Set<WebSocket>();
	chain: Chain;
	port = 8080;

	constructor() {
		this.chain = new Chain();
		this.wss = new WebSocketServer({ port: this.port });

		this.wss.on("connection", (ws) => {
			this.clients.add(ws);

			ws.on("message", async (data) => {
				try {
					const message = data.toString();
					const amount = message.length * 0.5;
					const prevHash = this.chain.getLastTransaction().hash;

					const transaction = createTransaction(
						"user",
						message,
						amount,
						prevHash,
					);

					const added = this.chain.addTransaction(transaction);
					if (added) {
						broadcastTransaction(this.libp2p, transaction);
						console.log("Transaction broadcasted:", transaction);
					} else {
						console.error("Failed to add transaction to chain");
					}
				} catch (error) {
					console.error("Error handling WebSocket message:", error);
				}
			});

			ws.on("close", () => {
				this.clients.delete(ws);
			});
		});

		console.log(`Firehose started on ws://localhost:${this.port}`);
	}

	async initialize() {
		this.libp2p = await createLibp2p({
			addresses: { listen: ["/ip4/0.0.0.0/tcp/0"] },
			transports: [tcp()],
			peerDiscovery: [mdns()],
			connectionEncrypters: [noise()],
			streamMuxers: [yamux()],
			services: {
				pubsub: gossipsub({
					allowPublishToZeroTopicPeers: true,
				}),
				identify: identify(),
			},
		});

		this.libp2p.services.pubsub.subscribe(TRANSACTION_TOPIC);

		this.libp2p.services.pubsub.addEventListener(
			"message",
			(evt: CustomEvent<Message>) => {
				const topic = evt.detail.topic;
				switch (topic) {
					case TRANSACTION_TOPIC: {
						this.broadcastToClients(new TextDecoder().decode(evt.detail.data));
						break;
					}
				}
			},
		);
	}

	broadcastToClients(data: unknown) {
		const payload = JSON.stringify(data);
		for (const client of this.clients) {
			if (client.readyState === 1) {
				client.send(payload);
			}
		}
	}
}

async function main() {
	const firehose = new Firehose();
	await firehose.initialize();
}

main().catch((e) => console.log(e));
