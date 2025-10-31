import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import { z } from "zod";

const server = new McpServer({
	name: "resource-server",
	version: "1.0.0",
});

const historySchema = z.object({
	from: z.string(),
	message: z.string(),
});
type History = z.infer<typeof historySchema>;

let resourceLevel = 100;
const history: History[] = [{ from: "maril", message: "みんなで話そう!" }];

const wsClients = new Set<WebSocket>();

function notify(message: History) {
	const payload = JSON.stringify({ type: "newMessage", message });
	wsClients.forEach((ws) => {
		if (ws.readyState === ws.OPEN) {
			ws.send(payload);
		}
	});
}

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
		notify({ from, message });

		setTimeout(() => {
			resourceLevel = Math.min(100, resourceLevel + amount);
			console.log("回復", amount, "残量", resourceLevel);
		}, 5000);

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

app.post("/add", async (req, res) => {
	try {
		const data = historySchema.parse(req.body);
		history.push({ from: data.from, message: data.message });
		notify({ from: data.from, message: data.message });
		res.json({
			success: true,
			history,
		});
	} catch (err) {
		if (err instanceof z.ZodError) {
			res.status(400).json({ success: false, errors: err.errors });
		} else {
			res
				.status(500)
				.json({ success: false, message: "Internal server error" });
		}
	}
});

const port = parseInt(process.env.PORT || "3000", 10);
const serverInstance = app.listen(port, () => {
	console.log(`Resource MCP Server running on http://localhost:${port}/mcp`);
});

const wss = new WebSocketServer({ server: serverInstance });

wss.on("connection", (ws: WebSocket) => {
	wsClients.add(ws);
	ws.on("close", () => {
		wsClients.delete(ws);
	});
});
