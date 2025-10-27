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
import { ToolLoopAgent } from "ai";
import { createLibp2p } from "libp2p";
import { Chain } from "../chain/chain";
import { mergeTransaction } from "../chain/consensus";
import {
	CHAIN_SYNC_PROTOCOL,
	handleChainSyncProtocol,
	parseTransaction,
	requestChainSync,
	TRANSACTION_TOPIC,
} from "../libp2p/chain-protocol";
import { handleMetadataProtocol, METADATA_PROTOCOL } from "../libp2p/metadata";
import { onPeerConnect, onPeerDisconnect } from "../libp2p/peer";
import type { Metadata } from "../schema";
import { createInstructions } from "./instructions";
import { type CompanionToolsType, makeCompanionTools } from "./tools";

export type Services = {
	pubsub: ReturnType<ReturnType<typeof gossipsub>>;
	identify: ReturnType<ReturnType<typeof identify>>;
};

export class Companion {
	metadata: Metadata;
	companions: Map<string, Metadata>;
	chain: Chain;

	libp2p!: Libp2p<Services>;
	agent!: ToolLoopAgent<never, CompanionToolsType, never>;

	private isGenerating: boolean = false;

	constructor(metadata: Metadata) {
		this.metadata = metadata;
		this.companions = new Map();
		this.chain = new Chain("みんなで話そう!");
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
		this.libp2p.services.pubsub.subscribe(TRANSACTION_TOPIC);

		this.libp2p.services.pubsub.addEventListener(
			"message",
			(evt: CustomEvent<Message>) => {
				const topic = evt.detail.topic;
				switch (topic) {
					case TRANSACTION_TOPIC: {
						this.handleTransactionMessage(evt.detail);
						break;
					}
				}
			},
		);

		await this.libp2p.handle(METADATA_PROTOCOL, (data) =>
			handleMetadataProtocol(this.companions, this.metadata, data),
		);

		await this.libp2p.handle(CHAIN_SYNC_PROTOCOL, (data) =>
			handleChainSyncProtocol(this.chain, data),
		);

		this.libp2p.addEventListener(
			"peer:identify",
			async (evt: CustomEvent<IdentifyResult>) => {
				await onPeerConnect(this.companions, this.libp2p, evt);
				await requestChainSync(this.chain, this.libp2p, evt.detail.peerId);
			},
		);

		this.libp2p.addEventListener(
			"peer:disconnect",
			async (evt: CustomEvent<PeerId>) =>
				onPeerDisconnect(this.companions, evt),
		);

		this.companions.set(this.metadata.id, this.metadata);

		const instructions = createInstructions(this.metadata, this.companions);

		this.agent = new ToolLoopAgent({
			model: anthropic("claude-3-5-haiku-latest"),
			instructions,
			tools: this.createLocalTools(),
		});

		this.generate();
	}

	async generate() {
		if (this.isGenerating) {
			return;
		}

		this.isGenerating = true;

		try {
			const { text } = await this.agent.generate({
				prompt:
					"現在のリソース状況と会話履歴を確認して、instructionsに従って適切に発言してください。",
			});

			console.log(text);
		} finally {
			this.isGenerating = false;
		}
	}

	private createLocalTools(): CompanionToolsType {
		return makeCompanionTools(this.chain, this.libp2p);
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
				this.generate();
			} else {
				console.warn("Transaction merge failed, may need chain sync");
				console.log(this.chain.getAllTransactions());
			}
		} catch (error) {
			console.error("Error handling transaction message:", error);
		}
	}
}
