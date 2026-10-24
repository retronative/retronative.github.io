// Organization-wide facts and links. Project data lives in src/data/projects.json.
export const site = {
	name: 'RetroNative',
	url: 'https://retronative.github.io/',
	mission: 'Bringing classic games to modern platforms through native recompilation.',
	description:
		'RetroNative brings classic games to modern platforms through native recompilation: unofficial fan projects that translate a console game\'s code ahead of time into a native program. No game files are included.',
	github: {
		label: 'github.com/retronative',
		url: 'https://github.com/retronative',
	},
	ogImage: '/og/retronative.png',
	ogImageAlt: 'The RetroNative wordmark and the mission line on a dark grid.',
} as const;
