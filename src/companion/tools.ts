import type { Libp2p } from "@libp2p/interface";
import { tool } from "ai";
import { z } from "zod";
import type { Chain } from "../chain/chain";
import { createTransaction } from "../chain/transaction";
import { broadcastTransaction } from "../libp2p/chain-protocol";
import type { Services } from "./companion";

export function makeCompanionTools(chain: Chain, libp2p: Libp2p<Services>) {
	const consumeTool = tool({
		description: "指定量のリソースを消費して発言します",
		inputSchema: z.object({
			amount: z.number().min(0).max(100).describe("消費するリソース量"),
			message: z.string().describe("発言内容"),
			from: z.string().describe("発言者のID"),
		}),
		execute: async ({
			amount,
			message,
			from,
		}: {
			amount: number;
			message: string;
			from: string;
		}) => {
			if (!chain.canConsume(amount)) {
				const currentResource = chain.calculateResource();
				return {
					success: false,
					resource: currentResource,
					message: "Not enough resource.",
				};
			}

			const lastTx = chain.getLastTransaction();
			const transaction = createTransaction(from, message, amount, lastTx.hash);

			const added = chain.addTransaction(transaction);

			if (!added) {
				return {
					success: false,
					resource: chain.calculateResource(),
					message: "Failed to add transaction to chain.",
				};
			}

			broadcastTransaction(libp2p, transaction);

			const newResource = chain.calculateResource();
			console.log("消費", amount, "残量", newResource);
			console.log(chain.getHistory());

			return {
				success: true,
				resource: newResource,
				message: "Resource consumed.",
			};
		},
	});

	const statusTool = tool({
		description: "現在のリソース残量を返します",
		inputSchema: z.object({}),
		execute: async () => {
			const resource = chain.calculateResource();
			return { resource };
		},
	});

	const historyTool = tool({
		description: "現在の会話履歴を返します",
		inputSchema: z.object({}),
		execute: async () => {
			const history = chain.getHistory();
			return { history };
		},
	});

	return {
		consume: consumeTool,
		status: statusTool,
		history: historyTool,
	};
}

export type CompanionToolsType = ReturnType<typeof makeCompanionTools>;
