import type { Connection, Libp2p, PeerId, Stream } from "@libp2p/interface";
import { type Metadata, MetadataSchema } from "..";

export const METADATA_PROTOCOL = "/aikyo/metadata/1.0.0";

export async function handleMetadataProtocol(
	companions: Map<string, Metadata>,
	metadata: Metadata,
	{ stream, connection }: { stream: Stream; connection: Connection },
) {
	const id = connection.remotePeer.toString();
	if (companions.get(id)) return stream.close();
	await stream.sink([new TextEncoder().encode(JSON.stringify(metadata))]);
	stream.close();
}

export async function requestMetadata(
	companions: Map<string, Metadata>,
	libp2p: Libp2p,
	peerId: PeerId,
) {
	const id = peerId.toString();
	if (companions.get(id)) return;
	const stream = await libp2p.dialProtocol(peerId, METADATA_PROTOCOL);
	const chunks: Uint8Array[] = [];
	for await (const c of stream.source) chunks.push(c.subarray());
	if (chunks.length) {
		const msg = JSON.parse(new TextDecoder().decode(chunks[0]));
		const parsed = MetadataSchema.safeParse(msg);
		console.debug({ parsed }, "Received metadata from peer");
		if (parsed.success) companions.set(id, parsed.data);
	}
	stream.close();
}
