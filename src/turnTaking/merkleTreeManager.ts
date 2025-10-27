import { addLeaf, generateMerkleTree } from "@node101/merkle-tree";
import type { MerkleTree } from "@node101/merkle-tree/build/types";
import type { Transaction } from "../schema";

export class MerkleTreeManager {
	tree: MerkleTree | undefined;

	constructor() {
		generateMerkleTree([], (err, merkleTree) => {
			if (err) return console.error(err);
			if (!merkleTree)
				return console.error("merkleTreeの初期化に失敗しました。");
			this.tree = merkleTree;
		});
		//初期トランザクションを作成
		this.addTransaction({ type: "RELEASE", score: 1 });
	}

	addTransaction(transaction: Transaction) {
		const str = JSON.stringify(transaction);
		if (!this.tree) return console.error("merkleTreeが初期化されていません。");
		addLeaf(this.tree, str, (err, updatedMerkleTree) => {
			if (err) return console.log(err);
			console.log(updatedMerkleTree);
		});
	}

	getRoot() {
		if (!this.tree) return console.error("merkleTreeが初期化されていません。");
		return this.tree.root;
	}

	getLatest() {
		return this.tree?.leavesArray[this.tree.leavesArray.length - 1];
	}
}
