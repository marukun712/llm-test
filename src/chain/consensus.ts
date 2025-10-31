import type { Transaction } from "../schema";
import type { Chain } from "./chain";

export function resolveConflict(
	currentChain: Chain,
	receivedTransactions: Transaction[],
): boolean {
	if (receivedTransactions.length > currentChain.getLength()) {
		return currentChain.replaceChain(receivedTransactions);
	}
	return false;
}

export function mergeTransaction(
	currentChain: Chain,
	newTransaction: Transaction,
): boolean {
	const lastTx = currentChain.getLastTransaction();
	if (newTransaction.timestamp >= lastTx.timestamp) {
		return currentChain.addTransaction(newTransaction);
	}
	console.warn(
		"Transaction does not connect to current chain tip, potential fork detected",
	);
	return false;
}
