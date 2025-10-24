import type { State } from "../schema";

export function decideNextSpeaker(states: State[]) {
	//selected(指名された)コンパニオンがいる場合
	const selectedAgents = states.filter((state) => state.selected);
	if (selectedAgents.length > 0) {
		//importanceの最大値をとって最大のコンパニオンをspeakerとする
		const speaker = selectedAgents.sort((a, b) => b.importance - a.importance);
		return speaker[0];
	}

	//speakの意思を持っているコンパニオンがいる場合
	const speakAgents = states.filter((state) => state.state === "speak");
	if (speakAgents.length > 0) {
		//importanceの最大値をとって最大のコンパニオンをspeakerとする
		const speaker = speakAgents.sort((a, b) => b.importance - a.importance);
		return speaker[0];
	}
}
