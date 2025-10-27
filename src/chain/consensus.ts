import type { Chain } from "./chain";
import type { Transaction } from "./transaction";

export function selectLongestChain(chains: Chain[]): Chain | null {
	if (chains.length === 0) {
		return null;
	}

	let longest: Chain | undefined = chains[0];
	if (!longest) {
		return null;
	}

	for (const chain of chains) {
		if (chain.getLength() > longest.getLength()) {
			longest = chain;
		}
	}

	return longest;
}

export function resolveConflict(
	currentChain: Chain,
	receivedTransactions: Transaction[],
): boolean {
	const currentLength = currentChain.getLength();
	const receivedLength = receivedTransactions.length;

	if (receivedLength > currentLength) {
		if (currentChain.replaceChain(receivedTransactions)) {
			console.info("Chain replaced successfully");
			return true;
		}
		console.warn("Chain replacement failed validation");
	}

	return false;
}

export function mergeTransaction(
	currentChain: Chain,
	newTransaction: Transaction,
): boolean {
	// 現在のチェーンの最後のトランザクションを取得
	const lastTx = currentChain.getLastTransaction();

	// トランザクションが現在のチェーンに接続できるかチェック
	if (newTransaction.prevHash === lastTx.hash) {
		// 直接追加可能
		return currentChain.addTransaction(newTransaction);
	}

	// prevHashが一致しない場合は分岐が発生している
	console.warn(
		"Transaction does not connect to current chain tip, potential fork detected",
	);

	return false;
}
