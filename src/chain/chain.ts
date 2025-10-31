import type { Transaction } from "../schema";
import { MerkleTreeManager } from "./tree";

export class Chain {
	private latestTransaction: Transaction[] = [];
	private tree: MerkleTreeManager;

	constructor() {
		this.tree = new MerkleTreeManager();
	}

	validateChain(rootHash: string): boolean {
		return rootHash === this.tree.getRoot();
	}

	getRemaining(): number {
		const last = this.getLastTransaction();
		return last.remaining;
	}

	addTransaction(tx: Transaction) {
		this.tree.add(JSON.stringify(tx));
	}

	getHistory(): { from: string; message: string }[] {
		return this.latestTransaction.map((tx) => ({
			from: tx.from,
			message: tx.message,
		}));
	}

	getLastTransaction(): Transaction {
		const last = this.latestTransaction[this.latestTransaction.length - 1];
		if (!last) {
			throw new Error("Chain has no transactions");
		}
		return last;
	}

	getAllTransactions(): Transaction[] {
		return this.latestTransaction;
	}
}
