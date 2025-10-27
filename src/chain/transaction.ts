import { createHash } from "node:crypto";

export interface Transaction {
	from: string;
	message: string;
	amount: number;
	timestamp: number;
	prevHash: string;
	hash: string;
}

export function calculateHash(
	from: string,
	message: string,
	amount: number,
	timestamp: number,
	prevHash: string,
): string {
	const data = `${from}:${message}:${amount}:${timestamp}:${prevHash}`;
	return createHash("sha256").update(data).digest("hex");
}

export function createTransaction(
	from: string,
	message: string,
	amount: number,
	prevHash: string,
	genesis?: boolean,
): Transaction {
	const timestamp = genesis ? 0 : Date.now();
	const hash = calculateHash(from, message, amount, timestamp, prevHash);

	return {
		from,
		message,
		amount,
		timestamp,
		prevHash,
		hash,
	};
}

export function validateTransactionHash(tx: Transaction): boolean {
	const expectedHash = calculateHash(
		tx.from,
		tx.message,
		tx.amount,
		tx.timestamp,
		tx.prevHash,
	);
	return tx.hash === expectedHash;
}

export function validateTransactionLink(
	tx: Transaction,
	prevTx: Transaction | null,
): boolean {
	if (prevTx === null) {
		return tx.prevHash === "";
	}
	return tx.prevHash === prevTx.hash;
}
