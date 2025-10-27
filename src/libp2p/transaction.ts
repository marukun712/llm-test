import type { Message } from "@libp2p/interface";
import { TransactionSchema } from "../schema";
import type { TransactionManager } from "../turnTaking/transactionManager";

export const handleTransaction = async (
	manager: TransactionManager,
	companionId: string,
	message: CustomEvent<Message>,
) => {
	try {
		const data = new TextDecoder().decode(message.detail.data);
		const json = JSON.parse(data);
		const parsed = TransactionSchema.safeParse(json);
		if (!parsed.success) {
			console.error("[Transaction] パース失敗:", parsed.error);
			return;
		}

		// 自分のトランザクションはスキップ
		if (parsed.data.companionId === companionId) {
			console.log(
				`[${companionId}] Skip:${parsed.data.type} ${parsed.data.score}`,
			);
			return;
		}

		manager.addTransaction(parsed.data);
	} catch (e) {
		console.error(`[${companionId}] Error:`, e);
	}
};
