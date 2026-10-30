const apiUrl = (process.env.PULSE_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');

if (!/^https:\/\/[^/]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiUrl)) {
	throw new Error(`PULSE_API_URL inválida: "${apiUrl}". Use https://api.seudominio.com`);
}

/** Opções comuns ao build e ao servidor local. */
export const buildOptions = {
	entryPoints: {
		'p/v1': 'src/p.ts',
		'p/editor-v1': 'src/editor/index.ts'
	},
	bundle: true,
	format: 'iife',
	target: 'es2019',
	charset: 'utf8',
	legalComments: 'none',
	define: {
		__PULSE_API_URL__: JSON.stringify(apiUrl)
	}
};
