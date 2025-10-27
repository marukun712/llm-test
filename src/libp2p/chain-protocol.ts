import type { Connection, Libp2p, PeerId, Stream } from "@libp2p/interface";
import type { Chain } from "../chain/chain";
import { resolveConflict } from "../chain/consensus";
import type { Transaction } from "../chain/transaction";
import type { Services } from "../index";
import { TransactionSchema } from "../schema";

export const CHAIN_SYNC_PROTOCOL = "/aikyo/chain/1.0.0";
export const TRANSACTION_TOPIC = "transaction";

export async function handleChainSyncProtocol(
	chain: Chain,
	{ stream }: { stream: Stream; connection: Connection },
) {
	try {
		const transactions = chain.getAllTransactions();
		const data = JSON.stringify(transactions);
		await stream.sink([new TextEncoder().encode(data)]);
		stream.close();
	} catch (error) {
		console.error("Error handling chain sync protocol:", error);
		stream.close();
	}
}

export async function requestChainSync(
	chain: Chain,
	libp2p: Libp2p<Services>,
	peerId: PeerId,
): Promise<boolean> {
	try {
		const stream = await libp2p.dialProtocol(peerId, CHAIN_SYNC_PROTOCOL);
		const chunks: Uint8Array[] = [];

		for await (const chunk of stream.source) {
			chunks.push(chunk.subarray());
		}

		stream.close();

		if (chunks.length === 0) {
			console.warn("Received empty chain from peer");
			return false;
		}

		const concatenated = new Uint8Array(
			chunks.reduce((acc, chunk) => acc + chunk.length, 0),
		);
		let offset = 0;
		for (const chunk of chunks) {
			concatenated.set(chunk, offset);
			offset += chunk.length;
		}

		const data = new TextDecoder().decode(concatenated);
		const receivedTransactions: Transaction[] = JSON.parse(data);

		const updated = resolveConflict(chain, receivedTransactions);

		return updated;
	} catch (error) {
		console.error(
			`Error requesting chain from peer ${peerId.toString()}:`,
			error,
		);
		return false;
	}
}

export function broadcastTransaction(
	libp2p: Libp2p<Services>,
	transaction: Transaction,
): void {
	try {
		const data = JSON.stringify(transaction);
		const encoded = new TextEncoder().encode(data);

		libp2p.services.pubsub.publish(TRANSACTION_TOPIC, encoded);
	} catch (error) {
		console.error("Error broadcasting transaction:", error);
	}
}

export function parseTransaction(data: Uint8Array): Transaction | null {
	try {
		const decoded = new TextDecoder().decode(data);
		const transaction: Transaction = JSON.parse(decoded);

		const parsed = TransactionSchema.safeParse(transaction);
		if (!parsed.success) {
			return null;
		}

		return transaction;
	} catch (error) {
		console.error("Error parsing transaction:", error);
		return null;
	}
}
