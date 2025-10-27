import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Transaction } from "../schema";

export class TransactionManager {
	transactions: Transaction[];

	constructor() {
		this.transactions = [
			{
				type: "RELEASE",
				score: 1,
				companionId: "system",
			},
		];
	}

	addTransaction(transaction: Transaction) {
		const previousHash = this.getLatestHash();
		const txWithHash: Transaction = {
			...transaction,
			previousHash,
		};
		this.transactions.push(txWithHash);
		console.log(
			`[${transaction.companionId}]: ${transaction.type} ${transaction.score}`,
		);
	}

	getLatestHash(): string {
		if (this.transactions.length === 0) {
			return "genesis";
		}
		const latest = this.transactions[this.transactions.length - 1];
		const hash = sha256(new TextEncoder().encode(JSON.stringify(latest)));
		return bytesToHex(hash);
	}

	getRoot(): string {
		return this.getLatestHash();
	}

	getTransactions(): Transaction[] {
		return this.transactions;
	}

	calculateRemaining(): number {
		let remaining = 0;
		for (const tx of this.transactions) {
			if (tx.type === "RELEASE") {
				remaining = Math.min(1, remaining + tx.score);
			} else if (tx.type === "CONSUME") {
				remaining = Math.max(0, remaining - tx.score);
			}
		}
		console.log(`計算結果 残量: ${Math.round(remaining * 100) / 100}`);
		return Math.round(remaining * 100) / 100;
	}
}
