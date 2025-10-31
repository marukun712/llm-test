import crypto from "node:crypto";
import { MerkleTree } from "merkletreejs";

export class MyMerkleTree {
	private tree: MerkleTree;

	constructor(elements: string[]) {
		const leaves = elements.map((el) => this.sha256(el));

		this.tree = new MerkleTree(leaves, this.sha256, {
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
