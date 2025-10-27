import {
	McpServer,
	ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const server = new McpServer({
	name: "resource-server",
	version: "1.0.0",
});

let resourceLevel = 1.0;
const hisotry: { from: string; message: string }[] = [];

server.registerTool(
	"consume",
	{
		title: "Consume Resource",
		description: "指定量のリソースを消費します（残量未満でないと失敗）",
		inputSchema: {
			amount: z.number().min(0).max(1),
			message: z.string(),
			from: z.string(),
		},
		outputSchema: {
			success: z.boolean(),
			resource: z.number(),
			message: z.string(),
		},
	},
	async ({ amount, from, message }) => {
		if (amount > resourceLevel) {
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							success: false,
							resource: resourceLevel,
							message: "Not enough resource.",
						}),
					},
				],
				structuredContent: {
					success: false,
					resource: resourceLevel,
					message: "Not enough resource.",
				},
			};
		}

		resourceLevel -= amount;
		console.log("消費", amount, "残量", resourceLevel);
		hisotry.push({ from, message });
		console.log(hisotry);

		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						success: true,
						resource: resourceLevel,
						message: "Resource consumed.",
					}),
				},
			],
			structuredContent: {
				success: true,
				resource: resourceLevel,
				message: "Resource consumed.",
			},
		};
	},
);

server.registerTool(
	"release",
	{
		title: "Release Resource",
		description: "指定量のリソースを開放します(最大1まで)",
		inputSchema: { amount: z.number().min(0).max(1) },
		outputSchema: {
			success: z.boolean(),
			resource: z.number(),
			message: z.string(),
		},
	},
	async ({ amount }) => {
		resourceLevel = Math.min(1, resourceLevel + amount);
		console.log("解放", amount, "残量", resourceLevel);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						success: true,
						resource: resourceLevel,
						message: "Resource released.",
					}),
				},
			],
			structuredContent: {
				success: true,
				resource: resourceLevel,
				message: "Resource released.",
			},
		};
	},
);

server.registerTool(
	"status",
	{
		title: "Check Resource Status",
		description: "現在のリソース残量を返します",
		inputSchema: {},
		outputSchema: { resource: z.number() },
	},
	async () => {
		return {
			content: [
				{ type: "text", text: JSON.stringify({ resource: resourceLevel }) },
			],
			structuredContent: { resource: resourceLevel },
		};
	},
);

server.registerResource(
	"resource",
	new ResourceTemplate("resource://current", { list: undefined }),
	{
		title: "Resource Status",
		description: "現在のリソース残量を示すリソース",
	},
	async (uri) => ({
		contents: [
			{
				uri: uri.href,
				text: `Current resource level: ${resourceLevel.toFixed(3)}`,
			},
		],
	}),
);

server.registerResource(
	"history",
	new ResourceTemplate("resource://history", { list: undefined }),
	{
		title: "History",
		description: "現在の会話履歴を返す",
	},
	async (uri) => ({
		contents: [
			{
				uri: uri.href,
				text: `${JSON.stringify(hisotry)}`,
			},
		],
	}),
);

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});

	res.on("close", () => {
		transport.close();
	});

	await server.connect(transport);
	await transport.handleRequest(req, res, req.body);
});

const port = parseInt(process.env.PORT || "3000", 10);
app
	.listen(port, () => {
		console.log(`Resource MCP Server running on http://localhost:${port}/mcp`);
	})
	.on("error", (error) => {
		console.error("Server error:", error);
		process.exit(1);
	});
