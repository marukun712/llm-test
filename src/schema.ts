import z from "zod";

export const StateSchema = z.object({
	id: z.string(),
	state: z
		.enum(["speak", "listen"])
		.describe("Whether you are the next speaker or listener"),
	importance: z
		.number()
		.min(0)
		.max(10)
		.describe("If you speak, its importance score. If you don't speak, 0."),
	selected: z
		.boolean()
		.describe(
			"Whether you were selected as an adjacent pair by the speaker in the last utterance in the conversation history",
		),
	closing: z
		.enum(["none", "pre-closing", "closing", "terminal"])
		.describe(
			"Please rate how you would like this conversation to end, using the following four-step scale. none: The conversation continues as is. pre-closing: Setting the stage for the end of the conversation. closing: Closing remarks, etc. terminal: Terminal adjacent pair (e.g., Goodbye!)",
		),
});

export type State = z.infer<typeof StateSchema>;

export const GenerateSchema = z.object({
	thought: z.string().describe("あなたの思考ログ"),
	message: z
		.string()
		.describe(
			"発言する場合は与えられたキャラクターとして発言するメッセージ。しない場合はnull。",
		)
		.nullable(),
});

export const MetadataSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		personality: z.string(),
		story: z.string(),
		sample: z.string(),
	})
	.strict();

export type Metadata = z.infer<typeof MetadataSchema>;
