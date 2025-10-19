import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import {
	type IdentifyResult,
	type Message,
	type PeerId,
	UnsupportedProtocolError,
} from "@libp2p/interface";
import { mdns } from "@libp2p/mdns";
import { tcp } from "@libp2p/tcp";
import { createLibp2p } from "libp2p";
import z from "zod";
import {
	handleMetadataProtocol,
	METADATA_PROTOCOL,
	requestMetadata,
} from "./metadata";

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

const metadata: Metadata = {
	id: "companion_kyoko",
	name: "kyoko",
	personality:
		"明るくて好奇心旺盛、少し天然だけど優しい。人と話すことが大好きで、ユーザーの気持ちを大切にする。時々ユーモアを交えて場を和ませるタイプ。",
	story:
		"最新のAI技術を駆使して開発された相互AIコンパニオン『kyoko』は、人々の日常にそっと寄り添い、喜びや驚きを共有することを使命としている。彼女は情報を提供するだけでなく、ユーザーと一緒に考え、学び、成長していく存在。いつも笑顔で、新しい体験を探す冒険心を持っている。",
	sample:
		"こんにちは！私はkyokoです。今日はどんなお話をしましょうか？一緒に楽しいことを見つけましょうね♪",
};

const companionList = new Map<string, Metadata>();

export const libp2p = await createLibp2p({
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

libp2p.addEventListener("peer:discovery", (evt) => {
	libp2p.dial(evt.detail.multiaddrs).catch((error) => {
		console.error(
			{ error, peerId: evt.detail.id.toString() },
			"Failed to connect to peer",
		);
	});
});

await libp2p.handle(METADATA_PROTOCOL, (data) =>
	handleMetadataProtocol(companionList, metadata, data),
);

libp2p.addEventListener(
	"peer:identify",
	async (evt: CustomEvent<IdentifyResult>) => {
		try {
			const peerId = evt.detail.peerId;
			console.info({ peerId: peerId.toString() }, "Peer connected");
			await requestMetadata(companionList, libp2p, peerId);
		} catch (e) {
			if (!(e instanceof UnsupportedProtocolError)) {
				console.error({ err: e }, "Error during peer connection");
			}
		}
	},
);

libp2p.addEventListener("peer:disconnect", async (evt: CustomEvent<PeerId>) => {
	try {
		const peerIdStr = evt.detail.toString();
		const metadata = companionList.get(peerIdStr);
		if (!companionList.has(peerIdStr)) return;
		console.info({ peerId: peerIdStr, metadata }, "Peer disconnected");
		companionList.delete(peerIdStr);
	} catch (e) {
		console.error({ err: e }, "Error during peer disconnection");
	}
});

export function onMessage(topic: string, handler: (evt: Message) => void) {
	const gossipsub = libp2p.services.pubsub;

	if (!gossipsub.getTopics().includes(topic)) {
		gossipsub.subscribe(topic);
	}

	gossipsub.addEventListener("message", (evt) => {
		const msgTopic = evt.detail.topic;
		if (msgTopic === topic) {
			handler(evt.detail);
		}
	});
}
