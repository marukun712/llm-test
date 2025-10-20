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
	console.log(`[${companion.metadata.id}] Received message:`, json);
	await companion.input(decoded);
});

const checkAndSpeak = async () => {
	if (
		companion.state.listeningTo === null &&
		companion.state.wantToRespond &&
		companion.state.message !== ""
	) {
		await new Promise<void>((resolve) => setTimeout(() => resolve(), 5000));
		companion.sendMessage(
			"message",
			JSON.stringify({
				from: companion.metadata.id,
				text: companion.state.message,
			}),
		);
	}
};

companion.event.addListener("listeningTo", checkAndSpeak);

setTimeout(() => {
	companion.input(
		JSON.stringify({
			from: "user_maril",
			message: "こんにちは!ayaさんはなにをしていますか?",
		}),
	);
}, 1000);
