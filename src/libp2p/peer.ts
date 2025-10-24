import {
	type IdentifyResult,
	type Libp2p,
	type PeerId,
	UnsupportedProtocolError,
} from "@libp2p/interface";
import type { Metadata } from "../index.js";
import { requestMetadata } from "./metadata.js";

export const onPeerConnect = async (
	companions: Map<string, Metadata>,
	libp2p: Libp2p,
	evt: CustomEvent<IdentifyResult>,
) => {
	try {
		const peerId = evt.detail.peerId;
		console.info({ peerId: peerId.toString() }, "Peer connected");
		await requestMetadata(companions, libp2p, peerId);
	} catch (e) {
		if (!(e instanceof UnsupportedProtocolError)) {
			console.error({ err: e }, "Error during peer connection");
		}
	}
};

export const onPeerDisconnect = async (
	companions: Map<string, Metadata>,
	evt: CustomEvent<PeerId>,
) => {
	try {
		const peerIdStr = evt.detail.toString();
		const metadata = companions.get(peerIdStr);
		if (!metadata) return;
		console.info({ peerId: peerIdStr, metadata }, "Peer disconnected");
		companions.delete(peerIdStr);
	} catch (e) {
		console.error({ err: e }, "Error during peer disconnection");
	}
};
