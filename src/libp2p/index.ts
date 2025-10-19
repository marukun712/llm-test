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
} from "./metadata.ts";

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
	metadata: MetadataSchema.describe(
		"あなたの情報。あなたはこのキャラクターになりきって行動します。",
	),
	companions: z.map(
		z.string().describe("同じネットワークにいるコンパニオンのID"),
		MetadataSchema,
	),
	thoughts: z.array(z.string()),
	speaker: z
		.string()
		.describe(
			"話しているコンパニオンのID。発言は同時に一人までしかできません。",
		),
	speakState: z
		.boolean()
		.describe(
			"現在の発言者の発言が終了したと感じた場合/次の発言者があなたへ発言を求めていると感じた場合/自分が継続して発言したい場合はtrue、だれかが継続して発言中の場合はfalse",
		),
	message: z.string().describe("あなたが発言者になった場合、次に話したい内容"),
});
export type State = z.infer<typeof stateSchema>;

const outputSchema = z.object({
	metadata: MetadataSchema.describe(
		"あなたの情報。あなたはこのキャラクターになりきって行動します。",
	),
	think: z.string(),
	speaker: z
		.string()
		.describe(
			"話しているコンパニオンのID。発言は同時に一人までしかできません。",
		),
	speakState: z
		.boolean()
		.describe(
			"現在の発言者の発言が終了したと感じた場合/次の発言者があなたへ発言を求めていると感じた場合/自分が継続して発言したい場合はtrue、だれかが継続して発言中の場合はfalse",
		),
	message: z.string().describe("あなたが発言者になった場合、次に話したい内容"),
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
	input: (text: string) => Promise<void>;
	onMessage: (topic: string, handler: (evt: Message) => void) => void;
	initialize: (metadata: Metadata) => Promise<void>;
}

export class Companion implements ICompanion {
	libp2p!: Libp2p<Services>;
	metadata!: Metadata;
	event: EventEmitter;
	state: State;

	constructor(metadata: Metadata) {
		this.metadata = metadata;
		this.event = new EventEmitter();
		this.state = {
			metadata: this.metadata,
			companions: new Map(),
			thoughts: [],
			speaker: "",
			speakState: false,
			message: "",
		};
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
			handleMetadataProtocol(this.state.companions, this.metadata, data),
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
					await requestMetadata(this.state.companions, this.libp2p, peerId);
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
					const peerMetadata = this.state.companions.get(peerIdStr);
					if (!this.state.companions.has(peerIdStr)) return;
					console.info(
						{
							peerId: peerIdStr,
							metadata: peerMetadata,
							companionId: this.metadata.id,
						},
						"Peer disconnected",
					);
					this.state.companions.delete(peerIdStr);
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
		const { object } = await generateObject({
			model: anthropic("claude-haiku-4-5"),
			schema: outputSchema.partial(),
			prompt: `以下の情報から、更新が必要だと感じた状態のみ更新を出力してください。現在の状態は以下の通りです。${JSON.stringify(
				this.state,
			)} 情報:${text}`,
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
		this.libp2p.services.pubsub.publish(topic, encoded);
	}
}
