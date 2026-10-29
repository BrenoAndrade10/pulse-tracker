/** Estilos do editor, isolados no Shadow DOM (nada vaza para a página, nem dela para cá). */
export const EDITOR_CSS = `
:host {
	all: initial;
	--bg: #14121c;
	--bg-elevated: #1b1826;
	--surface: #24202f;
	--surface-hover: #2c2738;
	--border: rgb(255 255 255 / 0.08);
	--border-strong: rgb(255 255 255 / 0.16);
	--fg: #f4f2fa;
	--fg-muted: #b3adc4;
	--fg-subtle: #827b94;
	--primary: #7c5cff;
	--primary-soft: #a996ff;
	--accent: #ff4d9d;
	--success: #2fd38d;
	--danger: #ff5c7a;
	--radius: 12px;
	font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
	font-size: 14px;
	line-height: 1.45;
	color: var(--fg);
}
*, *::before, *::after { box-sizing: border-box; }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
[hidden] { display: none !important; }
.grow { flex: 1; min-width: 0; }
.plain { border: 0; margin: 0; padding: 0; min-width: 0; }

.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }

.highlight {
	position: fixed;
	border: 2px solid var(--primary);
	background: rgb(124 92 255 / 0.12);
	border-radius: 6px;
	box-shadow: 0 0 0 4px rgb(124 92 255 / 0.18);
	transition: top .08s ease-out, left .08s ease-out, width .08s ease-out, height .08s ease-out;
}
.highlight.locked { border-style: solid; background: rgb(124 92 255 / 0.18); }
.highlight-label {
	position: absolute;
	left: -2px;
	bottom: calc(100% + 6px);
	max-width: 320px;
	padding: 3px 8px;
	border-radius: 6px;
	background: var(--primary);
	color: #fff;
	font-size: 12px;
	font-weight: 600;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.highlight-label.below { bottom: auto; top: calc(100% + 6px); }

.marker {
	position: fixed;
	border: 2px dashed var(--success);
	border-radius: 6px;
	background: rgb(47 211 141 / 0.06);
}
.marker-label {
	position: absolute;
	top: -11px;
	right: -2px;
	padding: 1px 7px;
	border-radius: 999px;
	background: var(--success);
	color: #06281a;
	font-size: 11px;
	font-weight: 700;
	white-space: nowrap;
}

.toolbar {
	position: fixed;
	left: 50%;
	bottom: 20px;
	transform: translateX(-50%);
	z-index: 2147483647;
	pointer-events: auto;
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 6px;
	border: 1px solid var(--border-strong);
	border-radius: 999px;
	background: var(--bg-elevated);
	box-shadow: 0 18px 50px -12px rgb(0 0 0 / 0.65);
	max-width: calc(100vw - 24px);
}
.brand {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 0 10px 0 8px;
	font-weight: 800;
	letter-spacing: -0.01em;
	white-space: nowrap;
}
.brand-dot {
	width: 10px;
	height: 10px;
	border-radius: 50%;
	background: linear-gradient(135deg, var(--primary), var(--accent));
	box-shadow: 0 0 0 3px rgb(124 92 255 / 0.25);
}
.status {
	padding: 0 6px;
	color: var(--fg-muted);
	font-size: 13px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	max-width: 260px;
}

.btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	height: 36px;
	padding: 0 14px;
	border: 1px solid var(--border-strong);
	border-radius: 999px;
	background: var(--surface);
	font-size: 13px;
	font-weight: 700;
	white-space: nowrap;
	transition: background .15s, border-color .15s, opacity .15s;
}
.btn:hover:not(:disabled) { background: var(--surface-hover); }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.btn:focus-visible, .field:focus-visible, .choice input:focus-visible + span { outline: 2px solid var(--primary-soft); outline-offset: 2px; }
.btn.primary {
	border-color: transparent;
	background: linear-gradient(135deg, var(--primary), var(--accent));
	color: #fff;
}
.btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
.btn.active { background: var(--fg); color: var(--bg); border-color: transparent; }
.btn.ghost { background: transparent; border-color: transparent; color: var(--fg-muted); }
.btn.ghost:hover:not(:disabled) { color: var(--fg); background: var(--surface); }
.btn.danger { color: var(--danger); }
.btn.icon { width: 36px; padding: 0; }
.count {
	min-width: 20px;
	height: 20px;
	padding: 0 6px;
	border-radius: 999px;
	background: var(--primary);
	color: #fff;
	font-size: 11.5px;
	line-height: 20px;
	text-align: center;
}

.panel {
	position: fixed;
	top: 16px;
	right: 16px;
	bottom: 84px;
	z-index: 2147483647;
	width: min(380px, calc(100vw - 32px));
	pointer-events: auto;
	display: flex;
	flex-direction: column;
	border: 1px solid var(--border-strong);
	border-radius: 16px;
	background: var(--bg-elevated);
	box-shadow: 0 30px 70px -20px rgb(0 0 0 / 0.75);
	animation: slide-in .2s ease-out;
}
@keyframes slide-in { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
	.panel { animation: none; }
	.highlight { transition: none; }
}
@media (max-width: 560px) {
	.panel { top: auto; left: 12px; right: 12px; bottom: 76px; width: auto; max-height: 70vh; }
	.status { display: none; }
}
.panel-header {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	padding: 18px 18px 14px;
	border-bottom: 1px solid var(--border);
}
.panel-header h2 { margin: 0; font-size: 16px; font-weight: 800; }
.panel-header p { margin: 3px 0 0; color: var(--fg-muted); font-size: 13px; }
.panel-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 18px; display: flex; flex-direction: column; gap: 16px; }
.panel-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--border); }

.element-card {
	display: flex;
	gap: 10px;
	align-items: center;
	padding: 10px 12px;
	border-radius: var(--radius);
	background: var(--surface);
}
.tag {
	flex-shrink: 0;
	padding: 2px 7px;
	border-radius: 6px;
	background: rgb(124 92 255 / 0.18);
	color: var(--primary-soft);
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 12px;
}
.element-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.label { display: block; margin-bottom: 6px; color: var(--fg-muted); font-size: 13px; font-weight: 600; }
.hint { margin: 6px 0 0; color: var(--fg-subtle); font-size: 12.5px; }
.error { margin: 6px 0 0; color: var(--danger); font-size: 12.5px; }
.field {
	width: 100%;
	height: 42px;
	padding: 0 12px;
	border: 1px solid var(--border);
	border-radius: 10px;
	background: var(--surface);
	outline: none;
}
.field:focus { border-color: var(--primary); }
select.field { appearance: none; background-image: linear-gradient(45deg, transparent 50%, var(--fg-muted) 50%), linear-gradient(135deg, var(--fg-muted) 50%, transparent 50%); background-position: calc(100% - 18px) 18px, calc(100% - 13px) 18px; background-size: 5px 5px; background-repeat: no-repeat; padding-right: 34px; }

.choices { display: grid; gap: 8px; }
.choice { position: relative; display: block; }
.choice input { position: absolute; opacity: 0; pointer-events: none; }
.choice span {
	display: block;
	padding: 10px 12px;
	border: 1px solid var(--border);
	border-radius: 10px;
	background: var(--surface);
	cursor: pointer;
}
.choice span small { display: block; color: var(--fg-subtle); font-size: 12px; }
.choice input:checked + span { border-color: var(--primary); background: rgb(124 92 255 / 0.12); }

.tip {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px;
	border: 1px solid rgb(124 92 255 / 0.35);
	border-radius: 10px;
	background: rgb(124 92 255 / 0.1);
	font-size: 13px;
}
.tip p { margin: 0; color: var(--fg-muted); }
.warning {
	margin: 0;
	padding: 9px 12px;
	border: 1px solid rgb(255 181 71 / 0.35);
	border-radius: 10px;
	background: rgb(255 181 71 / 0.08);
	color: #ffe2b3;
	font-size: 12.5px;
}
.fields { display: flex; flex-direction: column; gap: 10px; }
.fields h3 { margin: 0; }
.field-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.field-row {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 10px 12px;
	border: 1px solid var(--border);
	border-radius: 10px;
	background: var(--surface);
}
.field-name { font-weight: 600; font-size: 13.5px; overflow-wrap: anywhere; }
.field-name small { margin-left: 6px; color: var(--fg-subtle); font-weight: 400; font-size: 12px; }
.field-controls { display: grid; grid-template-columns: 1fr; gap: 8px; }
.field.compact { height: 36px; font-size: 13px; background-color: var(--bg-elevated); }
.notice {
	padding: 10px 12px;
	border: 1px solid rgb(255 92 122 / 0.3);
	border-radius: 10px;
	background: rgb(255 92 122 / 0.08);
	color: #ffc2cd;
	font-size: 13px;
}

.rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.rule {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 12px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	background: var(--surface);
}
.rule-main { min-width: 0; flex: 1; }
.rule-title { font-weight: 700; }
.rule-meta { color: var(--fg-subtle); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rule-missing { color: #ffd38a; }
.empty { color: var(--fg-muted); font-size: 13.5px; text-align: center; padding: 28px 8px; }

.toast {
	position: fixed;
	left: 50%;
	bottom: 78px;
	transform: translateX(-50%);
	z-index: 2147483647;
	padding: 9px 14px;
	border-radius: 999px;
	background: var(--fg);
	color: var(--bg);
	font-size: 13px;
	font-weight: 700;
	box-shadow: 0 12px 30px -10px rgb(0 0 0 / 0.6);
	animation: toast-in .2s ease-out;
}
@keyframes toast-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
`;
