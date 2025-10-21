import { EventEmitter } from "node:events";
import { anthropic } from "@ai-sdk/anthropic";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import {
	type IdentifyResult,
	type Libp2p,
	type Message,
	type PeerId,
	UnsupportedProtocolError,
} from "@libp2p/interface";
import { mdns } from "@libp2p/mdns";
import { tcp } from "@libp2p/tcp";
import { generateObject } from "ai";
import { createLibp2p } from "libp2p";
import z from "zod";
import {
	handleMetadataProtocol,
	METADATA_PROTOCOL,
	requestMetadata,
} from "./libp2p/metadata.ts";

export const MetadataSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		personality: z.string(),
		story: z.string(),
		sample: z.string(),
	})
	.strict();
export type Metadata = z.infer<typeof MetadataSchema>;

const stateSchema = z.object({
	thoughts: z.array(z.string()).describe("内的思考のログ"),
	conversationHistory: z
		.array(
			z.object({
				from: z.string(),
				text: z.string(),
			}),
		)
		.describe("最近の会話履歴"),
	speakers: z.array(z.string()).describe("現在話しているコンパニオンのID配列"),
	message: z
		.string()
		.nullable()
		.describe(
			"話者が誰もいない場合、発言したい内容。speakersに値が入っている場合はnullを入れる。",
		),
});
export type State = z.infer<typeof stateSchema>;

const outputSchema = z.object({
	think: z.string().describe("内的思考のログ"),
	speakers: z.array(z.string()).describe("現在話しているコンパニオンのID配列"),
	message: z
		.string()
		.nullable()
		.describe(
			"話者が誰もいない場合、発言したい内容。speakersに値が入っている場合はnullを入れる。",
		),
});

export type Services = {
	pubsub: ReturnType<ReturnType<typeof gossipsub>>;
	identify: ReturnType<ReturnType<typeof identify>>;
};

export interface ICompanion {
	libp2p: Libp2p<Services>;
	metadata: Metadata;
	event: EventEmitter;
	state: State;
	companions: Map<string, Metadata>;
	input: (text: string) => Promise<void>;
	onMessage: (topic: string, handler: (evt: Message) => void) => void;
	initialize: (metadata: Metadata) => Promise<void>;
}

export class Companion implements ICompanion {
	libp2p!: Libp2p<Services>;
	metadata!: Metadata;
	event: EventEmitter;
	state: State;
	companions: Map<string, Metadata>;

	constructor(metadata: Metadata) {
		this.metadata = metadata;
		this.event = new EventEmitter();
		this.state = {
			thoughts: [],
			conversationHistory: [],
			speakers: [],
			message: null,
		};
		this.companions = new Map();
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
					emitSelf: true,
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

		await this.libp2p.handle(METADATA_PROTOCOL, (data) =>
			handleMetadataProtocol(this.companions, this.metadata, data),
		);

		this.libp2p.addEventListener(
			"peer:identify",
			async (evt: CustomEvent<IdentifyResult>) => {
				try {
					const peerId = evt.detail.peerId;
					console.info(
						{ peerId: peerId.toString(), companionId: this.metadata.id },
						"Peer connected",
					);
					await requestMetadata(this.companions, this.libp2p, peerId);
				} catch (e) {
					if (!(e instanceof UnsupportedProtocolError)) {
						console.error(
							{ err: e, companionId: this.metadata.id },
							"Error during peer connection",
						);
					}
				}
			},
		);

		this.libp2p.addEventListener(
			"peer:disconnect",
			async (evt: CustomEvent<PeerId>) => {
				try {
					const peerIdStr = evt.detail.toString();
					const peerMetadata = this.companions.get(peerIdStr);
					if (!this.companions.has(peerIdStr)) return;
					console.info(
						{
							peerId: peerIdStr,
							metadata: peerMetadata,
							companionId: this.metadata.id,
						},
						"Peer disconnected",
					);
					this.companions.delete(peerIdStr);
				} catch (e) {
					console.error(
						{ err: e, companionId: this.metadata.id },
						"Error during peer disconnection",
					);
				}
			},
		);
	}

	async input(text: string) {
		const prompt = `
    このネットワーク全体のコンパニオンは以下の通りです。
    ${Array.from(this.companions.entries())
			.map(([_key, value]) => JSON.stringify(value))
			.join(",")}

    あなたのメタデータは以下の通りです。この指示に忠実に従ってください。
    ${JSON.stringify(this.metadata)}

    現在の状態
    ${JSON.stringify(this.state)}

    あなたは人間のように自然に会話するコンパニオンです。
    現在の状況をもとに、発話するかどうかを判断してください。

    ルール:
    - 他人が話しているときは、基本的に話さない。
    - 間ができたら、あなたの意見や感想を短く述べてもよい。
    - 自分が長く話しすぎたと感じたら、発話を止めて相手の反応を待つ。
    - 会話を盛り上げる意図がある場合のみ、相手の発話を補足してもよい。

    出力:
    {
      "think": "あなたの心の中の思考",
      "speakers": [...],
      "message": "発言内容またはnull"
    }

    受信した情報
    ${text}
    `;

		const { object } = await generateObject({
			model: anthropic("claude-haiku-4-5"),
			schema: outputSchema.partial(),
			prompt,
		});
		const { think, ...merged } = object;
		if (think) this.state.thoughts.push(think);
		Object.assign(this.state, merged);
		const keys = Object.keys(object);
		for (const key of keys) {
			this.event.emit(key);
		}
	}

	onMessage(topic: string, handler: (evt: Message) => void) {
		const pubsub = this.libp2p.services.pubsub;

		if (!pubsub.getTopics().includes(topic)) {
			pubsub.subscribe(topic);
		}

		pubsub.addEventListener("message", (evt) => {
			const msgTopic = evt.detail.topic;
			if (msgTopic === topic) {
				handler(evt.detail);
			}
		});
	}

	sendMessage(topic: string, data: string) {
		const encoded = new TextEncoder().encode(data);
		this.state.conversationHistory.push({ from: this.metadata.id, text: data });
		this.libp2p.services.pubsub.publish(topic, encoded);
	}
}
