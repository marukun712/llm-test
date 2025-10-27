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

	private isGenerating: boolean = false;

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
    ${JSON.stringify(Array.from(this.companions.values()))}

    ## ターンテイキングのルール
    あなたには、ターンテイキングMCPサーバーが与えられています。
    このサーバーは0~100のリソースと会話履歴を持っていて、発言にはリソースを消費する必要があります。

    ### 発言時の手順(厳守)

    #### ステップ1: 必ず最初に会話履歴を確認
    - 「history」リソースを読んで、これまでの会話を把握してください
    - 誰が何を言ったか、どんな話題が出ているかをよく確認してください
    - **これまでに出た発言と同じ内容を繰り返さないでください**

    #### ステップ2: リソース状況を確認
    - 「status」ツールで現在のリソース残量を確認してください

    #### ステップ3: 発言の長さを決定

    **発言の長さの選択肢:**

    短い相槌（5リソース、10文字以内
    - 使用例: 「そうだね！」「なるほど」「わかる！」「面白い！」「確かに」「いいね！」
    - 会話のテンポを作る最も重要な要素です

    通常の発言(70リソース、50文字以内)
    - 相手の発言に対して、少し意見を加えたい時のみ
    - 使用条件: リソース80以上 会話を発展させる必要がある

    ■ 長めの発言（90リソース、100文字以内) 例外的な状況のみ
    - 会話履歴が0~2件の時に新しい話題を始める場合のみ
    - または、リソースが100で複雑な説明が必要な時のみ
    - 通常の会話では使わないでください

    #### ステップ4: リソース消費量（固定値）
    - 短い相槌: 5リソース（10文字以内）
    - 通常の発言: 30リソース（50文字以内）
    - 長めの発言: 70リソース（100文字以内）

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
			model: anthropic("claude-haiku-4-5"),
			instructions,
			tools,
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

			this.libp2p.services.pubsub.publish(
				"spoke",
				new TextEncoder().encode(this.metadata.id),
			);
		} finally {
			this.isGenerating = false;
		}
	}
}
