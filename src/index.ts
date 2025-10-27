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
import { generateObject, generateText } from "ai";
import { createLibp2p } from "libp2p";
import { LoroDoc, type LoroList, type LoroMap } from "loro-crdt";
import z from "zod";
import { handleMetadataProtocol, METADATA_PROTOCOL } from "./libp2p/metadata";
import { onPeerConnect, onPeerDisconnect } from "./libp2p/peer";
import { handleCRDTSync, setupCRDTSync } from "./libp2p/sync";
import type { Metadata } from "./schema";

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

	history: LoroList;

	constructor(metadata: Metadata) {
		this.doc = new LoroDoc();
		this.metadata = metadata;
		this.event = new EventEmitter();
		this.thoughts = [];
		this.companions = new Map();

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

		this.libp2p.services.pubsub.addEventListener(
			"message",
			(evt: CustomEvent<Message>) => {
				const topic = evt.detail.topic;
				switch (topic) {
					case "crdt-sync": {
						handleCRDTSync(this.doc, evt);
						break;
					}
				}
			},
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

	getRandomInt(min: number, max: number) {
		const minCeiled = Math.ceil(min);
		const maxFloored = Math.floor(max);
		return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled); // 上限は除き、下限は含む
	}

	getRemaining() {
		const remaining = this.states.get("resource");
		const parsed = z.number().min(0).max(1).safeParse(remaining);
		if (!parsed.success) return null;
		return parsed.data;
	}

	getMaxTokens(remaining: number): number {
		const minTokens = 50;
		const maxTokens = 200;
		return Math.round(minTokens + (maxTokens - minTokens) * remaining);
	}

	consume(score: number) {
		const remaining = this.getRemaining();
		if (remaining === null) return;
		const newRemaining = Math.round(Math.max(0, remaining - score) * 100) / 100;
		console.log("リソース", score, "消費 残量:", newRemaining);
		this.states.set("resource", newRemaining);
		this.doc.commit();
	}

	release(score: number) {
		const remaining = this.getRemaining();
		if (remaining === null) return;
		const newRemaining = Math.round(Math.min(1, remaining + score) * 100) / 100;
		console.log("リソース解放", score, "残量:", newRemaining);
		this.states.set("resource", newRemaining);
		this.doc.commit();
	}

	async generate() {
		const remaining = this.getRemaining();
		if (remaining === null || remaining <= 0) return;

		const scorePrompt = `
    このネットワークでの会話状況は以下の通りです。
    ${JSON.stringify(this.history.toArray().slice(-5))}
    リソースは最大1、最小0です。
    現在の残りリソースは ${remaining} です。
    発言の長さに応じて消費量を決めてください。
    短い相槌は0.1〜0.2、通常は0.3〜0.5、長い発言は0.6〜0.8です。
    残りリソースを超えないようにしてください。
    `;

		const { object } = await generateObject({
			model: anthropic("claude-3-5-haiku-latest"),
			prompt: scorePrompt,
			schema: z.object({ score: z.number().min(0).max(remaining) }),
		});

		this.consume(object.score);

		await new Promise<void>((r) =>
			setTimeout(r, this.getRandomInt(1000, 8000) / (remaining + 0.1)),
		);

		const updatedRemaining = this.getRemaining();
		if (updatedRemaining === null || updatedRemaining <= 0) return;

		const messagePrompt = `
    あなたのメタデータは、${JSON.stringify(this.metadata)}です。この設定に忠実にふるまってください。
    このネットワークでの会話状況は以下の通りです。
    ${JSON.stringify(this.history.toArray().slice(-5))}
    先ほど ${object.score} を消費して発言することにしました。
    この会話の続きを ${this.getMaxTokens(object.score)} トークン以内で生成してください。
    重要:出力は発言のみとし、かならずあなたに与えられたメタデータのキャラクターとしての発言を出力してください。
    `;

		const { text } = await generateText({
			model: anthropic("claude-3-5-haiku-latest"),
			prompt: messagePrompt,
			maxOutputTokens: this.getMaxTokens(object.score),
		});

		console.log(text);
		this.history.push({ from: this.metadata.id, message: text });
		this.doc.commit();
	}
}
