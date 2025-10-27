import z from "zod";

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

export const TransactionSchema = z
	.object({
		type: z.enum(["CONSUME", "RELEASE"]),
		score: z.number().min(0).max(1),
		companionId: z.string(),
		previousHash: z.string().optional(),
	})
	.strict();

export type Transaction = z.infer<typeof TransactionSchema>;
