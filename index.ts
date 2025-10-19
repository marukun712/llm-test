import { EventEmitter } from "node:events";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import z from "zod";
import { onMessage } from "./src/libp2p";

const event = new EventEmitter();

const stateSchema = z.object({
	companions: z.array(
		z.string().describe("同じネットワークにいるコンパニオンのID"),
	),
	thoughts: z.array(
		z.string().describe("あなたの感じたことの要約と、あなたの考え"),
	),
	speaker: z
		.string()
		.describe(
			"話しているコンパニオンのID。発言は同時に一人までしかできません。",
		),
	endSpeak: z.boolean().describe("現在の発言者の発言が終了したかどうか"),
	message: z.string().describe("あなたが発言者になった場合、次に話したい内容"),
});

type State = z.infer<typeof stateSchema>;
const state: State = {
	companions: [],
	thoughts: [],
	speaker: "",
	endSpeak: true,
	message: "",
};

async function input(text: string) {
	const { object } = await generateObject({
		model: anthropic("claude-haiku-4-5"),
		schema: stateSchema.partial(),
		prompt: `以下の情報から、更新が必要だと感じた状態のみ更新してください。現在の状態は以下の通りです。${JSON.stringify(state)} 情報:${text}`,
	});
	Object.assign(state, object);
	const keys = Object.keys(object);
	for (const key of keys) {
		event.emit(key);
	}
}

onMessage("message", async (message) => {
	const decoded = new TextDecoder().decode(message.data);
	console.log(decoded);
	await input(decoded);
});
