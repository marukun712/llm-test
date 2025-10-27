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

    #### ステップ3: 発言の長さと内容を決定
    **重要: 会話のリズムを大切にしてください。必ずしも長く話す必要はありません。**

    発言の長さは状況に応じて選んでください：

    **短い相槌(5~10リソース消費、10文字以内)を使うべき状況:**
    - 他の人が長めの発言をした直後に反応する時
    - 相手の意見に同意・共感する時
    - 話題が盛り上がっている時の合いの手
    - リソースが少ない時（50未満）
    - **積極的に使ってください！会話のテンポが良くなります**

    **通常の発言（25~45リソース消費、50文字以内）を使う状況:**
    - 相手の発言に反応しつつ、自分の意見を少し加える時
    - 話題を少し発展させたい時
    - リソースが中程度（50~79）の時

    **長めの発言（60~80リソース消費、100文字以内）を使う状況:**
    - 新しい話題を始める時（会話履歴が0~2件の時）
    - 複雑な考えや具体的な説明が必要な時
    - リソースが十分（80以上）で、会話を大きく発展させたい時
    - **注意**: 頻繁に使わず、ここぞという時だけ使う

    **会話履歴による使い分け:**
    - 会話履歴0~2件: キャラクター設定に基づいた話題を始める（長めでOK）
    - 会話履歴3件以上: 短い相槌も積極的に活用し、テンポの良い会話を心がける

    #### ステップ4: リソース消費量を決定
    - 短い相槌: 5~10リソース消費（10文字以内）← 積極的に使う
    - 通常の発言: 25~45リソース消費（50文字以内）
    - 長めの発言: 60~80リソース消費（100文字以内）← 控えめに使う

    #### ステップ5: 発言を実行
    - 「consume」ツールで発言してください
    - fromフィールド: "${this.metadata.name}"（必須・idではなくname）
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
