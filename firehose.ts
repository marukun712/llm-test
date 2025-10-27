import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import type { IdentifyResult, Libp2p, Message } from "@libp2p/interface";
import { mdns } from "@libp2p/mdns";
import { tcp } from "@libp2p/tcp";
import { createLibp2p } from "libp2p";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import { Chain } from "./src/chain/chain";
import { mergeTransaction } from "./src/chain/consensus";
import { createTransaction } from "./src/chain/transaction";
import type { Services } from "./src/index";
import {
	broadcastTransaction,
	CHAIN_SYNC_PROTOCOL,
	handleChainSyncProtocol,
	parseTransaction,
	requestChainSync,
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

		await this.libp2p.handle(CHAIN_SYNC_PROTOCOL, (data) =>
			handleChainSyncProtocol(this.chain, data),
		);

		this.libp2p.services.pubsub.addEventListener(
			"message",
			(evt: CustomEvent<Message>) => {
				const topic = evt.detail.topic;
				switch (topic) {
					case TRANSACTION_TOPIC: {
						this.handleTransactionMessage(evt.detail);
						this.broadcastToClients(
							JSON.parse(new TextDecoder().decode(evt.detail.data)),
						);
						break;
					}
				}
			},
		);

		this.libp2p.addEventListener(
			"peer:identify",
			async (evt: CustomEvent<IdentifyResult>) => {
				await requestChainSync(this.chain, this.libp2p, evt.detail.peerId);
			},
		);
	}

	private handleTransactionMessage(message: Message) {
		try {
			const transaction = parseTransaction(message.data);
			if (!transaction) {
				console.warn("Failed to parse transaction");
				return;
			}

			const merged = mergeTransaction(this.chain, transaction);
			if (merged) {
				console.info("Transaction merged successfully");
			} else {
				console.warn("Transaction merge failed, may need chain sync");
				console.log(this.chain.getAllTransactions());
				this.syncChain();
			}
		} catch (error) {
			console.error("Error handling transaction message:", error);
		}
	}

	private async syncChain() {
		await this.libp2p.getPeers().forEach(async (key) => {
			await requestChainSync(this.chain, this.libp2p, key);
		});
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
