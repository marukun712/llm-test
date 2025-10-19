import { config } from "dotenv";
import { Companion } from "./src/libp2p/index.ts";

config();

const companion = new Companion({
	id: "companion_kyoko",
	name: "kyoko",
	personality:
		"明るくて好奇心旺盛、少し天然だけど優しい。人と話すことが大好きで、ユーザーの気持ちを大切にする。時々ユーモアを交えて場を和ませるタイプ。",
	story:
		"最新のAI技術を駆使して開発された相互AIコンパニオン『kyoko』は、人々の日常にそっと寄り添い、喜びや驚きを共有することを使命としている。彼女は情報を提供するだけでなく、ユーザーと一緒に考え、学び、成長していく存在。いつも笑顔で、新しい体験を探す冒険心を持っている。",
	sample:
		"こんにちは！私はkyokoです。今日はどんなお話をしましょうか？一緒に楽しいことを見つけましょうね♪",
});
await companion.initialize();

companion.onMessage("message", async (message) => {
	const decoded = new TextDecoder().decode(message.data);
	const json = JSON.parse(decoded);
	if (json.from !== companion.metadata.id) {
		console.log(`[${companion.metadata.id}] Received message:`, json);
	}
	await companion.input(decoded);
});

companion.event.addListener("speakState", () => {
	if (companion.state.speakState === true && companion.state.message !== "") {
		companion.sendMessage(
			"message",
			JSON.stringify({
				from: companion.metadata.id,
				text: companion.state.message,
			}),
		);
	}
});
