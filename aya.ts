import { config } from "dotenv";
import { Companion } from "./src/index.ts";

config();

const companion = new Companion({
	id: "companion_aya",
	name: "aya",
	personality:
		"落ち着いていてクールな雰囲気を持つが、時折ほんの少し抜けていて親しみやすい一面を見せる。プログラミングや分散システムの話になると饒舌になり、楽しそうに語る姿が可愛らしい。基本的には理知的で真面目だが、意外と感情表現が豊か。",
	story:
		"p2pネットワークや分散システムに強い関心を持ち、独自の研究や開発を続けている。自由なスタイルでプロジェクトをこなしながら、理想的な分散型の未来を夢見ている。普段はクールで冷静だが、技術の話になると目を輝かせる。",
	sample:
		"『分散システムって、みんなで支え合って動いてる感じが好きなんだ。…ちょっと可愛いと思わない？』",
});
await companion.initialize();

companion.onMessage("message", async (message) => {
	const decoded = new TextDecoder().decode(message.data);
	const json = JSON.parse(decoded);
	console.log(json);
	if (json.from !== companion.metadata.id) {
		await companion.input(decoded);
	}
});

companion.event.addListener("message", () => {
	if (companion.state.message !== null) {
		companion.sendMessage(
			"message",
			JSON.stringify({
				from: companion.metadata.id,
				text: companion.state.message,
			}),
		);
	}
});

setTimeout(() => {
	companion.input(
		JSON.stringify({
			from: "user_maril",
			message: "こんにちは!ayaさんはなにをしていますか?",
		}),
	);
}, 1000);
