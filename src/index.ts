import { EventEmitter } from "node:events";
import { anthropic } from "@ai-sdk/anthropic";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import type {
	IdentifyResult,
	Libp2p,
	Message,
	PeerId,
} from "@libp2p/interface";
import { mdns } from "@libp2p/mdns";
import { tcp } from "@libp2p/tcp";
import { generateObject } from "ai";
import { createLibp2p } from "libp2p";
import { LoroDoc, type LoroList } from "loro-crdt";
import z from "zod";
import { handleMetadataProtocol, METADATA_PROTOCOL } from "./libp2p/metadata";
import { onPeerConnect, onPeerDisconnect } from "./libp2p/peer";
import { handleCRDTSync, setupCRDTSync } from "./libp2p/sync";
import { handleTransaction } from "./libp2p/transaction";
import type { Metadata } from "./schema";
import { ResourceManager } from "./turnTaking/resourceManager";
import { TransactionManager } from "./turnTaking/transactionManager";

export type Services = {
	pubsub: ReturnType<ReturnType<typeof gossipsub>>;
	identify: ReturnType<ReturnType<typeof identify>>;
};

export class Companion {
	doc: LoroDoc;
	metadata: Metadata;
	event: EventEmitter;
	libp2p!: Libp2p<Services>;
	thoughts: string[];
	companions: Map<string, Metadata>;
	resourceManager!: ResourceManager;
	transactionManager: TransactionManager;

	history: LoroList;

	constructor(metadata: Metadata) {
		this.doc = new LoroDoc();
		this.metadata = metadata;
		this.event = new EventEmitter();
		this.thoughts = [];
		this.companions = new Map();
		this.transactionManager = new TransactionManager();

		this.history = this.doc.getList("history");

		this.history.subscribe(() => {
			this.generate();
		});
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

		this.libp2p.addEventListener("peer:discovery", (evt) => {
			this.libp2p.dial(evt.detail.multiaddrs).catch((error) => {
				console.error(
					{
						error,
						peerId: evt.detail.id.toString(),
						companionId: this.metadata.id,
					},
					"Failed to connect to peer",
				);
			});
		});

		this.libp2p.services.pubsub.subscribe("crdt-sync");
		this.libp2p.services.pubsub.subscribe("transaction");

		this.libp2p.services.pubsub.addEventListener(
			"message",
			(evt: CustomEvent<Message>) => {
				const topic = evt.detail.topic;
				switch (topic) {
					case "crdt-sync": {
						handleCRDTSync(this.doc, evt);
						break;
					}
					case "transaction": {
						handleTransaction(this.transactionManager, this.metadata.id, evt);
						break;
					}
				}
			},
		);

		this.resourceManager = new ResourceManager(
			this.libp2p,
			this.metadata.id,
			this.transactionManager,
		);

		await this.libp2p.handle(METADATA_PROTOCOL, (data) =>
			handleMetadataProtocol(this.companions, this.metadata, data),
		);

		this.libp2p.addEventListener(
			"peer:identify",
			async (evt: CustomEvent<IdentifyResult>) =>
				onPeerConnect(this.companions, this.libp2p, evt),
		);

		this.libp2p.addEventListener(
			"peer:disconnect",
			async (evt: CustomEvent<PeerId>) =>
				onPeerDisconnect(this.companions, evt),
		);

		// CRDT同期の設定
		setupCRDTSync(this.doc, (topic, data) =>
			this.libp2p.services.pubsub.publish(topic, data),
		);

		this.companions.set(this.metadata.id, this.metadata);
	}

	getRemaining() {
		return this.transactionManager.calculateRemaining();
	}

	consume(score: number) {
		const remaining = this.getRemaining();
		if (remaining <= 0) return;
		this.resourceManager.consume(score);
		console.log(
			`[${this.metadata.name}] Resource ${score} 消費 残量: ${this.getRemaining()}`,
		);
	}

	release(score: number) {
		this.resourceManager.release(score);
		console.log(
			`[${this.metadata.name}] Resource ${score} 解放 残量: ${this.getRemaining()}`,
		);
	}

	async generate() {
		const remaining = this.getRemaining();
		if (remaining <= 0) return;

		const prompt = `
    あなたのメタデータは、${JSON.stringify(this.metadata)}です。この設定に忠実にふるまってください。
    このネットワークには以下のコンパニオンがいます。
    ${JSON.stringify(this.companions.values())}
    このネットワークでの会話状況は以下の通りです。
    ${JSON.stringify(this.history.toArray().slice(-5))}

    リソースは最大1、最小0です。現在の残りリソースは ${remaining} です。

    発言のタイプに応じて消費量を決めて、与えられたメタデータのキャラクターとしてのメッセージを生成してください。
    - 短い相槌(うん、はい、など):0.2
    - 通常の発言(普通の返答):0.8
    - 長い説明的な発言: 1.0

    重要:ただし、絶対に残りリソースを超えないようにしてください。
    `;

		const { object } = await generateObject({
			model: anthropic("claude-3-5-haiku-latest"),
			prompt: prompt,
			schema: z.object({
				message: z.string(),
				score: z.number().min(0).max(remaining),
			}),
		});

		this.consume(object.score);

		console.log(`[${this.metadata.name}]`, object.message);
		this.history.push({ from: this.metadata.id, message: object.message });
		this.doc.commit();
	}
}
