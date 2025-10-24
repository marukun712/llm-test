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
import { generateObject, generateText, Output, tool } from "ai";
import { createLibp2p } from "libp2p";
import { LoroDoc, type LoroList, type LoroMap } from "loro-crdt";
import z from "zod";
import { handleMetadataProtocol, METADATA_PROTOCOL } from "./libp2p/metadata";
import { onPeerConnect, onPeerDisconnect } from "./libp2p/peer";
import { handleCRDTSync, setupCRDTSync } from "./libp2p/sync";

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

export type Services = {
	pubsub: ReturnType<ReturnType<typeof gossipsub>>;
	identify: ReturnType<ReturnType<typeof identify>>;
};

const createCompanionNetworkTool = (companion: Companion) =>
	tool({
		description: "同じネットワークにいるコンパニオンのリストを取得します。",
		inputSchema: z.object({}),
		execute: async () => {
			return Array.from(companion.companions.entries())
				.map((metadata) => JSON.stringify(metadata, null, 2))
				.join("\n");
		},
	});

export class Companion {
	doc: LoroDoc;
	metadata: Metadata;
	event: EventEmitter;
	libp2p!: Libp2p<Services>;
	thoughts: string[];
	companions: Map<string, Metadata>;

	history: LoroList;
	states: LoroMap;

	constructor(metadata: Metadata) {
		this.doc = new LoroDoc();
		this.metadata = metadata;
		this.event = new EventEmitter();
		this.thoughts = [];
		this.companions = new Map();

		this.history = this.doc.getList("history");
		this.states = this.doc.getMap("states");

		this.history.subscribe(() => {
			this.refresh();
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
				if (topic === "crdt-sync") {
					handleCRDTSync(this.doc, evt);
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
		this.doc.commit();
		this.loop();
	}

	async loop() {
		const prompt = `
    あなたのメタデータは、${JSON.stringify(this.metadata)}です。この設定に忠実にふるまってください。
    あなたはいままでにこのような思考をしました。
    ${JSON.stringify(this.thoughts)}
    このネットワークでの会話状況は以下の通りです。
    ${this.history
			.toArray()
			.slice(-5)
			.map((m) => JSON.stringify(m, null, 2))
			.join("\n")}    
    ${JSON.stringify(this.states.toJSON())}
    この会話状況をもとに、以下のルールに従って発言してください。
    - 同一ネットワークでは同時に一人までしか発言できません。
    - 誰かが発言している場合は、短い相槌のみ発言可能です。
    `;

		console.log(prompt);

		const { experimental_output: object } = await generateText({
			model: anthropic("claude-haiku-4-5"),
			prompt,
			experimental_output: Output.object({
				schema: z.object({
					thought: z.string().describe("あなたの思考ログ"),
					message: z
						.string()
						.describe(
							"発言する場合は与えられたキャラクターとして発言するメッセージ。しない場合はnull。",
						)
						.nullable(),
				}),
			}),
			tools: { knowledge: createCompanionNetworkTool(this) },
		});

		console.log(object);

		if (object.message) {
			this.history.push({
				from: this.metadata.id,
				message: object.message,
			});
			this.doc.commit();
		}

		this.thoughts.push(object.thought);
	}

	async refresh() {
		const prompt = `
    Here are the last 5 messages:
    ${this.history
			.toArray()
			.slice(-5)
			.map((m) => JSON.stringify(m, null, 2))
			.join("\n")}
    
    Predict the next utterance status of the speakers in this conversation history.
    You are ${this.metadata.id}
    You must follow this JSON format.

    [
      {
        "state": "speak | listen",
        "importance": "number 0~10",
        "selected": "boolean"
      }
    ]
    `;

		const { object } = await generateObject({
			model: anthropic("claude-haiku-4-5"),
			prompt,
			schema: z.object({
				id: z.string(),
				state: z
					.enum(["speak", "listen"])
					.describe("Whether you are the next speaker or listener"),
				importance: z
					.number()
					.min(0)
					.max(10)
					.describe(
						"If you speak, its importance score. If you don't speak, 0.",
					),
				selected: z
					.boolean()
					.describe(
						"Whether you were selected as an adjacent pair by the speaker in the last utterance in the conversation history",
					),
			}),
		});

		this.states.set(this.metadata.id, object);
		this.doc.commit();
	}
}
