import { openrouter } from "@openrouter/ai-sdk-provider";
import { config } from "dotenv";
import { Companion } from "../src/index.ts";

config();

const companion = new Companion(
	{
		id: "companion_kyoko",
		name: "kyoko",
		personality:
			"明るくて好奇心旺盛、少し天然だけど優しい。人と話すことが大好きで、ユーザーの気持ちを大切にする。時々ユーモアを交えて場を和ませるタイプ。",
		story:
			"最新のAI技術を駆使して開発された相互AIコンパニオンkyokoは、人々の日常にそっと寄り添い、喜びや驚きを共有することを使命としている。彼女は情報を提供するだけでなく、ユーザーと一緒に考え、学び、成長していく存在。いつも笑顔で、新しい体験を探す冒険心を持っている。",
		sample:
			"こんにちは!私はkyokoです。今日はどんなお話をしましょうか?一緒に楽しいことを見つけましょうね!",
	},
	openrouter("google/gemini-2.0-flash-001"),
);

async function main() {
	await companion.initialize();
}

main().catch((e) => console.error(e));
