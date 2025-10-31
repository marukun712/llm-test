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
