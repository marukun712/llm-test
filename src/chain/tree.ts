import crypto from "node:crypto";
import { MerkleTree } from "merkletreejs";

export class MerkleTreeManager {
	private tree: MerkleTree;

	constructor() {
		this.tree = new MerkleTree([], this.sha256, {
			sortPairs: true,
		});
	}

	private sha256(data: string): Buffer {
		return crypto.createHash("sha256").update(data).digest();
	}

	add(data: string) {
		const hash = this.sha256(data);
		this.tree.addLeaf(hash);
	}

	getRoot(): string {
		return this.tree.getRoot().toString("hex");
	}
}
