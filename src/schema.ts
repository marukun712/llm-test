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

export const TransactionSchema = z.object({
	from: z.string(),
	message: z.string(),
	remaining: z.number(),
	timestamp: z.number(),
});

export type Transaction = z.infer<typeof TransactionSchema>;
