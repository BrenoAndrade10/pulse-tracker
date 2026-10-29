import * as esbuild from 'esbuild';
import { buildOptions } from './options.mjs';

// Serve a página de demonstração (www/) com o pixel e o editor recompilados a cada mudança.
const context = await esbuild.context({
	...buildOptions,
	outdir: 'www',
	sourcemap: 'inline'
});

await context.watch();
const { port } = await context.serve({ servedir: 'www', port: 5174 });

console.log(`Página de demonstração: http://localhost:${port}/`);
