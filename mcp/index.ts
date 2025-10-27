import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const server = new McpServer({
	name: "resource-server",
	version: "1.0.0",
});

let resourceLevel = 100;
const history: { from: string; message: string }[] = [
	{ from: "maril", message: "みんなで話そう!" },
];

server.registerTool(
	"consume",
	{
		title: "Consume Resource",
		description: "指定量のリソースを消費します（残量未満でないと失敗）",
		inputSchema: {
			amount: z.number().min(0).max(100),
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
		history.push({ from, message });
		console.log(history);

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

server.registerTool(
	"history",
	{
		title: "Check History",
		description: "現在の会話履歴を返します",
		inputSchema: {},
		outputSchema: {
			history: z.array(z.object({ from: z.string(), message: z.string() })),
		},
	},
	async () => {
		return {
			content: [{ type: "text", text: JSON.stringify({ history }) }],
			structuredContent: { history },
		};
	},
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

setInterval(() => {
	if (resourceLevel < 100) {
		const oldLevel = resourceLevel;
		resourceLevel = Math.min(100, resourceLevel + 10);
		console.log(`自動回復 +${resourceLevel - oldLevel} 残量 ${resourceLevel}`);
	}
}, 1000);

const port = parseInt(process.env.PORT || "3000", 10);
app
	.listen(port, () => {
		console.log(`Resource MCP Server running on http://localhost:${port}/mcp`);
	})
	.on("error", (error) => {
		console.error("Server error:", error);
		process.exit(1);
	});
