import { addLeaf, generateMerkleTree } from "@node101/merkle-tree";
import type { MerkleTree } from "@node101/merkle-tree/build/types";
import { type Transaction, TransactionSchema } from "../schema";

export class MerkleTreeManager {
	tree: MerkleTree | undefined;

	constructor() {
		const initialTransaction = JSON.stringify({
			type: "RELEASE",
			score: 1,
			companionId: "system",
		});

		generateMerkleTree([initialTransaction], (err, merkleTree) => {
			if (err) return console.error(err);
			if (!merkleTree)
				return console.error("merkleTreeの初期化に失敗しました。");
			this.tree = merkleTree;
		});
	}

	addTransaction(transaction: Transaction) {
		const str = JSON.stringify(transaction);
		if (!this.tree) return console.error("merkleTreeが初期化されていません。");
		addLeaf(this.tree, str, (err, updatedMerkleTree) => {
			if (err) return console.log(err);
			this.tree = updatedMerkleTree;
			console.log(
				`[MerkleTree] トランザクション追加: ${transaction.type} ${transaction.score} by ${transaction.companionId}`,
			);
		});
	}

	getRoot() {
		if (!this.tree) return console.error("merkleTreeが初期化されていません。");
		return this.tree.root;
	}

	getLatest() {
		return this.tree?.leavesArray[this.tree.leavesArray.length - 1];
	}

	getTransactions(): Transaction[] {
		if (!this.tree) return [];
		const transactions: Transaction[] = [];
		for (const leaf of this.tree.leavesArray) {
			try {
				const parsed = TransactionSchema.safeParse(JSON.parse(leaf));
				if (parsed.success) {
					transactions.push(parsed.data);
				}
			} catch (e) {
				console.error("トランザクションのパースに失敗:", e);
			}
		}
		return transactions;
	}

	calculateRemaining(): number {
		const transactions = this.getTransactions();
		console.log(
			`[MerkleTree] トランザクション総数: ${transactions.length}`,
			transactions.map((t) => `${t.type}:${t.score}`),
		);
		let remaining = 0;
		for (const tx of transactions) {
			if (tx.type === "RELEASE") {
				remaining = Math.min(1, remaining + tx.score);
			} else if (tx.type === "CONSUME") {
				remaining = Math.max(0, remaining - tx.score);
			}
		}
		console.log(`[MerkleTree] 計算結果 残量: ${remaining}`);
		return Math.round(remaining * 100) / 100;
	}
}
