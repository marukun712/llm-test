import { anthropic } from "@ai-sdk/anthropic";
import { experimental_createMCPClient } from "@ai-sdk/mcp";
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
import { ToolLoopAgent } from "ai";
import { createLibp2p } from "libp2p";
import { handleMetadataProtocol, METADATA_PROTOCOL } from "./libp2p/metadata";
import { onPeerConnect, onPeerDisconnect } from "./libp2p/peer";
import type { Metadata } from "./schema";

export type Services = {
	pubsub: ReturnType<ReturnType<typeof gossipsub>>;
	identify: ReturnType<ReturnType<typeof identify>>;
};

export class Companion {
	metadata: Metadata;
	companions: Map<string, Metadata>;

	libp2p!: Libp2p<Services>;
	agent!: ToolLoopAgent;

	constructor(metadata: Metadata) {
		this.metadata = metadata;
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

		this.libp2p.services.pubsub.subscribe("spoke");

		this.libp2p.services.pubsub.addEventListener(
			"message",
			(evt: CustomEvent<Message>) => {
				const topic = evt.detail.topic;
				switch (topic) {
					case "spoke": {
						this.generate();
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

		this.companions.set(this.metadata.id, this.metadata);

		const client = await experimental_createMCPClient({
			transport: {
				type: "http",
				url: "http://localhost:3000/mcp",
			},
		});

		const tools = await client.tools();

		const instructions = `
    あなたのメタデータは、${JSON.stringify(this.metadata)}です。この設定に忠実にふるまってください。
    このネットワークには以下のコンパニオンがいます。
    ${JSON.stringify(this.companions.values())}
    あなたには、ターンテイキングMCPサーバーが与えられています。
    このサーバーは0~1のリソースと会話履歴を持っていて、発言にはリソースを消費する必要があります。
    適切に現在のリソースと会話履歴を確認して、以下の指示に従い与えられたキャラクターとして続きのメッセージをMCPサーバーに送信してください。
    リソース 0~0.4 短い相槌 15文字以内
    リソース 0.5~0.8 通常の発言 100文字以内
    リソース 0.9~0.10 長い発言 200文字以内
    `;

		this.agent = new ToolLoopAgent({
			model: anthropic("claude-3-5-haiku-latest"),
			instructions,
			tools,
		});

		this.generate();
	}

	async generate() {
		const { text } = await this.agent.generate({
			prompt:
				"適切に現在のリソースと会話履歴を確認して、以下の指示に従い与えられたキャラクターとして続きのメッセージをMCPサーバーに送信してください。",
		});

		console.log(text);

		this.libp2p.services.pubsub.publish(
			"spoke",
			new TextEncoder().encode(this.metadata.id),
		);
	}
}
