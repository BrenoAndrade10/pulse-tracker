import * as esbuild from 'esbuild';
import { buildOptions } from './options.mjs';

const result = await esbuild.build({
	...buildOptions,
	outdir: 'dist',
	minify: true,
	metafile: true
});

for (const [file, output] of Object.entries(result.metafile.outputs)) {
	console.log(`${file}  ${(output.bytes / 1024).toFixed(1)} KB`);
}
