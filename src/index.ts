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
import { ToolLoopAgent, tool } from "ai";
import { createLibp2p } from "libp2p";
import { z } from "zod";
import { Chain } from "./chain/chain";
import { mergeTransaction } from "./chain/consensus";
import { createTransaction } from "./chain/transaction";
import {
	broadcastTransaction,
	CHAIN_SYNC_PROTOCOL,
	handleChainSyncProtocol,
	parseTransaction,
	requestChainSync,
	TRANSACTION_TOPIC,
} from "./libp2p/chain-protocol";
import { handleMetadataProtocol, METADATA_PROTOCOL } from "./libp2p/metadata";
import { onPeerConnect, onPeerDisconnect } from "./libp2p/peer";
import type { Metadata } from "./schema";

export type Services = {
	pubsub: ReturnType<ReturnType<typeof gossipsub>>;
	identify: ReturnType<ReturnType<typeof identify>>;
};

function makeCompanionTools(chain: Chain, libp2p: Libp2p<Services>) {
	const consumeTool = tool({
		description: "指定量のリソースを消費して発言します",
		inputSchema: z.object({
			amount: z.number().min(0).max(100).describe("消費するリソース量"),
			message: z.string().describe("発言内容"),
			from: z.string().describe("発言者のID"),
		}),
		execute: async ({
			amount,
			message,
			from,
		}: {
			amount: number;
			message: string;
			from: string;
		}) => {
			if (!chain.canConsume(amount)) {
				const currentResource = chain.calculateResource();
				return {
					success: false,
					resource: currentResource,
					message: "Not enough resource.",
				};
			}

			const lastTx = chain.getLastTransaction();
			const transaction = createTransaction(from, message, amount, lastTx.hash);

			const added = chain.addTransaction(transaction);

			if (!added) {
				return {
					success: false,
					resource: chain.calculateResource(),
					message: "Failed to add transaction to chain.",
				};
			}

			broadcastTransaction(libp2p, transaction);

			const newResource = chain.calculateResource();
			console.log("消費", amount, "残量", newResource);
			console.log(chain.getHistory());

			return {
				success: true,
				resource: newResource,
				message: "Resource consumed.",
			};
		},
	});

	const statusTool = tool({
		description: "現在のリソース残量を返します",
		inputSchema: z.object({}),
		execute: async () => {
			const resource = chain.calculateResource();
			return { resource };
		},
	});

	const historyTool = tool({
		description: "現在の会話履歴を返します",
		inputSchema: z.object({}),
		execute: async () => {
			const history = chain.getHistory();
			return { history };
		},
	});

	return {
		consume: consumeTool,
		status: statusTool,
		history: historyTool,
	};
}

type CompanionToolsType = ReturnType<typeof makeCompanionTools>;

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

		const instructions = `
    あなたのメタデータは、${JSON.stringify(this.metadata)}です。この設定に忠実にふるまってください。
    このネットワークには以下のコンパニオンがいます。
    ${JSON.stringify(Array.from(this.companions.values()))}

    ## ターンテイキングのルール
    分散型ハッシュチェーンによるターンテイキングシステムを使用しています。
    0~100のリソースと会話履歴がハッシュチェーンで管理され、発言にはリソースを消費する必要があります。

    ### 発言時の手順(厳守)

    #### ステップ1: 必ず最初に会話履歴を確認
    - 「history」ツールで、これまでの会話を把握してください
    - 誰が何を言ったか、どんな話題が出ているかをよく確認してください
    - **これまでに出た発言と同じ内容を繰り返さないでください**

    #### ステップ2: リソース状況を確認
    - 「status」ツールで現在のリソース残量を確認してください

    #### ステップ3: 発言の長さを決定

    **発言の長さの選択肢:**

    短い相槌（5リソース、10文字以内）
    - 使用例: 「そうだね！」「なるほど」「わかる！」「面白い！」「確かに」「いいね！」
    - 会話のテンポを作る最も重要な要素です

    通常の発言(30リソース、50文字以内)
    - 相手の発言に対して、少し意見を加えたい時のみ
    - 使用条件: リソース35以上、会話を発展させる必要がある

    長めの発言（70リソース、100文字以内）例外的な状況のみ
    - 会話履歴が0~2件の時に新しい話題を始める場合のみ
    - または、リソースが100で複雑な説明が必要な時のみ
    - 通常の会話では使わないでください

    #### ステップ4: リソース消費量（固定値）
    - 短い相槌: 5リソース(10文字以内)
    - 通常の発言: 30リソース(50文字以内)
    - 長めの発言: 70リソース(100文字以内)

    #### ステップ5: 発言を実行
    - 「consume」ツールで発言してください
    - fromフィールド: "${this.metadata.id}"
    - amount: 決定した消費量
    - message: キャラクターに合った、会話を進展させる内容

    ### 絶対に守るべきルール
    - 会話履歴を確認せずに発言することは禁止
    - 既に言われた内容の繰り返しは禁止
    - 抽象的な挨拶や問いかけの繰り返しは禁止(会話が進んでいる場合)
    - 必ず会話を前進させる内容にすること
    `;

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
			if (
				"from" in message &&
				message.from &&
				message.from.toString() === this.libp2p.peerId.toString()
			) {
				return;
			}

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
			}
		} catch (error) {
			console.error("Error handling transaction message:", error);
		}
	}
}
