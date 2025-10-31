import { experimental_createMCPClient } from "@ai-sdk/mcp";
import { type LanguageModel, ToolLoopAgent } from "ai";
import type { Metadata } from "../schema";
import { createInstructions } from "./instructions";

export class Companion {
	private metadata: Metadata;
	private agent!: ToolLoopAgent;
	private model: LanguageModel;
	private isGenerating: boolean = false;

	constructor(metadata: Metadata, model: LanguageModel) {
		this.metadata = metadata;
		this.model = model;
	}

	async initialize() {
		const client = await experimental_createMCPClient({
			transport: {
				type: "http",
				url: "http://localhost:3000/mcp",
			},
		});

		const tools = await client.tools();

		const instructions = createInstructions(this.metadata);
		this.agent = new ToolLoopAgent({
			model: this.model,
			instructions,
			tools,
		});

		setInterval(() => {
			this.generate();
		}, 5000);
	}

	async generate() {
		if (this.isGenerating) {
			return;
		}
		this.isGenerating = true;
		try {
			const { text } = await this.agent.generate({
				prompt:
					"現在のリソース状況と会話履歴を確認して、instructionsに従って適切に発言してください。",
			});
			console.log(text);
		} finally {
			this.isGenerating = false;
		}
	}
}
