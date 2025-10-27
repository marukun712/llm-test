import {
	createTransaction,
	type Transaction,
	validateTransactionHash,
	validateTransactionLink,
} from "./transaction";

const INITIAL_RESOURCE = 100;
const RECOVERY_TIME_MS = 5000;

export class Chain {
	private transactions: Transaction[] = [];

	constructor(genesisMessage = "") {
		const genesis = createTransaction("", genesisMessage, 0, "", true);
		this.transactions.push(genesis);
	}

	validateChain(): boolean {
		for (let i = 0; i < this.transactions.length; i++) {
			//それぞれトランザクションを取得
			const tx = this.transactions[i];
			if (!tx) {
				console.error(`Missing transaction at index ${i}`);
				return false;
			}

			let prevTx: Transaction | null = null;
			if (i > 0) {
				const prev = this.transactions[i - 1];
				if (!prev) {
					console.error(`Missing previous transaction at index ${i - 1}`);
					return false;
				}
				prevTx = prev;
			}

			//トランザクションのハッシュ値をチェック
			if (!validateTransactionHash(tx)) {
				console.error(`Invalid hash at transaction ${i}`);
				return false;
			}

			//一件前のハッシュと一致しているかチェック
			if (!validateTransactionLink(tx, prevTx)) {
				console.error(`Invalid link at transaction ${i}`);
				return false;
			}

			//リソースが負になっていないかチェック
			const resourceAtTime = this.calculateResourceAt(i);
			if (resourceAtTime < 0) {
				console.error(
					`Negative resource at transaction ${i}: ${resourceAtTime}`,
				);
				return false;
			}
		}
		return true;
	}

	//指定されたindexまでのリソース消費をチェック
	private calculateResourceAt(index: number): number {
		const targetTx = this.transactions[index];
		if (!targetTx) {
			return INITIAL_RESOURCE;
		}

		let resource = INITIAL_RESOURCE;

		for (let i = 0; i <= index; i++) {
			const tx = this.transactions[i];
			if (!tx) continue;
			const timeDiff = targetTx.timestamp - tx.timestamp;
			//すでにリソース回復時間に達している場合は除外
			if (timeDiff < RECOVERY_TIME_MS) {
				resource -= tx.amount;
			}
		}

		return resource;
	}

	//最新のトランザクションまでのリソース消費をチェック
	calculateResource(): number {
		const now = Date.now();
		let resource = INITIAL_RESOURCE;
		for (const tx of this.transactions) {
			const timeDiff = now - tx.timestamp;
			if (timeDiff < RECOVERY_TIME_MS) {
				resource -= tx.amount;
			}
		}
		return resource;
	}

	//消費したことでリソースが負にならないかチェック
	canConsume(amount: number): boolean {
		return this.calculateResource() >= amount;
	}

	addTransaction(tx: Transaction): boolean {
		const lastTx = this.transactions[this.transactions.length - 1];
		if (!lastTx) {
			console.error("Chain has no transactions");
			return false;
		}

		//チェーンの検証
		if (!validateTransactionLink(tx, lastTx)) {
			console.error("Invalid transaction link");
			return false;
		}

		if (!validateTransactionHash(tx)) {
			console.error("Invalid transaction hash");
			return false;
		}

		this.transactions.push(tx);

		//チェーンが不正だった場合取り消し
		if (!this.validateChain()) {
			this.transactions.pop();
			console.error("Chain validation failed after adding transaction");
			return false;
		}

		return true;
	}

	//チェーンから会話履歴だけとってくる
	getHistory(): { from: string; message: string }[] {
		return this.transactions.map((tx) => ({
			from: tx.from,
			message: tx.message,
		}));
	}

	getLength(): number {
		return this.transactions.length;
	}

	getLastTransaction(): Transaction {
		const last = this.transactions[this.transactions.length - 1];
		if (!last) {
			throw new Error("Chain has no transactions");
		}
		return last;
	}

	getAllTransactions(): Transaction[] {
		return [...this.transactions];
	}

	//チェーンを置き換え
	replaceChain(newTransactions: Transaction[]): boolean {
		const tempChain = new Chain();
		tempChain.transactions = [...newTransactions];

		if (!tempChain.validateChain()) {
			console.error("Invalid chain provided for replacement");
			return false;
		}

		this.transactions = newTransactions;
		return true;
	}
}
