import type { Message } from "@libp2p/interface";
import { TransactionSchema } from "../schema";
import type { MerkleTreeManager } from "../turnTaking/merkleTreeManager";

export const handleTransaction = async (
	tree: MerkleTreeManager,
	message: CustomEvent<Message>,
) => {
	const data = new TextDecoder().decode(message.detail.data);
	const parsed = TransactionSchema.safeParse(data);
	if (!parsed.success) return;
	tree.addTransaction(parsed.data);
};
