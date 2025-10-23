import { EventEmitter } from "node:events";
import { anthropic } from "@ai-sdk/anthropic";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import type { Libp2p, Message } from "@libp2p/interface";
import { mdns } from "@libp2p/mdns";
import { tcp } from "@libp2p/tcp";
import { generateObject } from "ai";
import { createLibp2p } from "libp2p";
import { LoroDoc, type LoroList, type LoroMap } from "loro-crdt";
import z from "zod";
import { handleCRDTSync, setupCRDTSync } from "./libp2p/sync";

const debounce = <T extends (...args: unknown[]) => unknown>(
	callback: T,
	delay = 250,
): ((...args: Parameters<T>) => void) => {
	let timeoutId: NodeJS.Timeout;
	return (...args) => {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => callback(...args), delay);
	};
};

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

export class Companion {
	doc: LoroDoc;
	metadata: Metadata;
	event: EventEmitter;
	libp2p!: Libp2p<Services>;

	companions: LoroMap;
	history: LoroList;
	states: LoroMap;

	constructor(metadata: Metadata) {
		this.doc = new LoroDoc();
		this.metadata = metadata;
		this.event = new EventEmitter();

		this.companions = this.doc.getMap("companions");
		this.history = this.doc.getList("history");
		this.states = this.doc.getMap("states");

		this.companions.set(this.metadata.id, this.metadata);

		this.history.subscribe(() => {
			debounce(this.refresh);
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

		// CRDT同期の設定
		setupCRDTSync(this.doc, (topic, data) =>
			this.libp2p.services.pubsub.publish(topic, data),
		);
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
    You must follow this JSON format.

    {
      "id (companion id)": {
        "state": "speak | listen",
        "importance": "number 0~10", // Importance of the statement
        "selected": "boolean" // Whether the speakers correspond as an adjacent pair in the last conversation
      }
      ...
    }
    `;

		const { object } = await generateObject({
			model: anthropic("claude-haiku-4-5"),
			prompt,
			schema: z.object({
				states: z.record(
					z.string(),
					z.object({
						state: z.enum(["speak", "listen"]),
						importance: z.number().min(0).max(10),
						selected: z.boolean(),
					}),
				),
			}),
		});

		console.log(object);
		this.states.set("latest", object);
	}
}
