/**
 * Pixel do Pulse. Instalado pelo cliente em todas as páginas:
 *   <script async src=".../p/v1.js" data-pixel="PX_..."></script>
 *
 * Modo normal: PageView, cliques e envios de formulário das regras.
 * Modo de configuração: aberto pelo Pulse com `#pulse_setup=<token>`, carrega
 * o editor visual por cima da página (e não registra nada).
 *
 * Consentimento: com `data-consent="required"`, nada é enviado nem o cookie é
 * criado até a página chamar `pulse('consent', 'granted')`.
 */

type RuleField = { slug: string; key: string; selector: string };
type Rule = {
	id: string;
	scope: 'page' | 'site';
	pageUrl: string;
	trigger: 'click' | 'submit';
	selector: string;
	fields: RuleField[];
};
type PulseEvent = {
	id: string;
	name: string;
	ruleId?: string;
	url: string;
	referrer: string;
	aid: string;
	sid: string;
	utm: Record<string, string>;
	fbclid?: string;
	lead?: { values: Record<string, string | boolean> };
};
type Command = [string, ...unknown[]];

const SETUP_PARAM = 'pulse_setup';
const SETUP_STORAGE_KEY = 'pulse:setup';
const TOKEN_PATTERN = /^[\w-]{43}$/;
const COOKIE = '_pulse_id';
const MAX_BATCH = 20;
const FLUSH_MS = 2000;
const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'];

/**
 * Token do modo de configuração. Sai da barra de endereço na hora (não fica
 * em prints nem em links compartilhados) e fica só nesta aba: recarregar ou
 * navegar pelo site mantém o editor aberto, fechar a aba encerra.
 */
function takeSetupToken(): string | null {
	const match = new RegExp(`(?:^#|&)${SETUP_PARAM}=([\\w-]+)`).exec(location.hash);

	if (match && TOKEN_PATTERN.test(match[1])) {
		try {
			sessionStorage.setItem(SETUP_STORAGE_KEY, match[1]);
		} catch {
			// Sem sessionStorage (ex.: bloqueado): o editor funciona até recarregar.
		}
		history.replaceState(history.state, '', location.pathname + location.search);
		return match[1];
	}

	try {
		const stored = sessionStorage.getItem(SETUP_STORAGE_KEY);
		return stored && TOKEN_PATTERN.test(stored) ? stored : null;
	} catch {
		return null;
	}
}

function loadEditor(script: HTMLScriptElement, api: string, token: string) {
	if (document.querySelector('script[data-pulse-editor]')) return;

	const editor = document.createElement('script');
	editor.src = new URL('editor-v1.js', script.src).href;
	editor.async = true;
	editor.dataset.pulseEditor = '';
	editor.dataset.api = api;
	editor.dataset.token = token;
	editor.dataset.storageKey = SETUP_STORAGE_KEY;
	document.head.appendChild(editor);
}

const canonicalPage = (url: string): string =>
	url.toLowerCase().replace('://www.', '://').replace(/\/+$/, '');

const uuid = (): string =>
	crypto.randomUUID?.() ??
	'10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
		(+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16)
	);

function session(key: string, create: () => string): string {
	try {
		let value = sessionStorage.getItem(key);
		if (!value) sessionStorage.setItem(key, (value = create()));
		return value;
	} catch {
		return create();
	}
}

/** Identificador anônimo do visitante: cookie primário, 12 meses. */
function anonymousId(): string {
	const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([\\w-]+)`));
	if (match) return match[1];

	const id = uuid();
	document.cookie = `${COOKIE}=${id}; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
	return id;
}

/** UTMs e fbclid da primeira página da sessão: o cadastro herda a origem da visita. */
function attribution(): { utm: Record<string, string>; fbclid?: string } {
	const params = new URLSearchParams(location.search);
	const current: { utm: Record<string, string>; fbclid?: string } = { utm: {} };
	for (const key of UTM_KEYS) {
		const value = params.get(`utm_${key}`);
		if (value) current.utm[key] = value.slice(0, 200);
	}
	const fbclid = params.get('fbclid');
	if (fbclid) current.fbclid = fbclid.slice(0, 500);

	try {
		const stored = sessionStorage.getItem('pulse:attribution');
		if (stored) return JSON.parse(stored) as typeof current;
		if (Object.keys(current.utm).length || current.fbclid) {
			sessionStorage.setItem('pulse:attribution', JSON.stringify(current));
		}
	} catch {
		// Sem sessionStorage: vale a origem desta página.
	}
	return current;
}

class Pixel {
	private queue: PulseEvent[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	private rules: Rule[] = [];
	private lastPage = '';
	private started = false;
	private stopped = false;
	private aid = '';
	private readonly sid = session('pulse:sid', uuid);

	constructor(
		private readonly api: string,
		private readonly key: string
	) {}

	/** Começa a registrar (já com consentimento, quando exigido). */
	start(): void {
		this.stopped = false;
		if (this.started) return;
		this.started = true;
		this.aid = anonymousId();

		void fetch(`${this.api}/t/${this.key}/config`, { credentials: 'omit' })
			.then((response) => (response.ok ? (response.json() as Promise<{ rules: Rule[] }>) : null))
			.then((config) => {
				this.rules = config?.rules ?? [];
			})
			.catch(() => {
				// Sem regras: continua só com PageView.
			});

		addEventListener('click', this.onClick, { capture: true, passive: true });
		document.addEventListener('submit', this.onSubmit, { capture: true });
		addEventListener('pagehide', () => this.flush());
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') this.flush();
		});

		// Sites que trocam de página sem recarregar (SPA).
		for (const method of ['pushState', 'replaceState'] as const) {
			const original = history[method];
			history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
				const result = original.apply(this, args);
				dispatchEvent(new Event('pulse:navigate'));
				return result;
			};
		}
		addEventListener('popstate', () => this.pageView());
		addEventListener('pulse:navigate', () => this.pageView());

		this.pageView();
	}

	private pageUrl(): string {
		return `${location.origin}${location.pathname}`;
	}

	private pageView(): void {
		const page = this.pageUrl();
		if (page === this.lastPage) return;
		this.lastPage = page;
		this.track('PageView');
	}

	private rulesFor(trigger: Rule['trigger']): Rule[] {
		const page = canonicalPage(this.pageUrl());
		return this.rules.filter(
			(rule) =>
				rule.trigger === trigger &&
				(rule.scope === 'site' || canonicalPage(rule.pageUrl) === page)
		);
	}

	private readonly onClick = (event: MouseEvent): void => {
		if (!(event.target instanceof Element)) return;
		let matched = false;
		for (const rule of this.rulesFor('click')) {
			try {
				if (event.target.closest(rule.selector)) {
					this.track('Rule', rule.id);
					matched = true;
				}
			} catch {
				// Seletor inválido nesta página: ignora a regra.
			}
		}
		if (matched) this.flush();
	};

	/** Lê só os campos mapeados na regra; senhas e cartões nunca são mapeáveis. */
	private readonly onSubmit = (event: SubmitEvent): void => {
		const form = event.target;
		if (!(form instanceof HTMLFormElement)) return;

		for (const rule of this.rulesFor('submit')) {
			let matches = false;
			try {
				matches = form.matches(rule.selector);
			} catch {
				continue;
			}
			if (!matches) continue;

			const values: Record<string, string | boolean> = {};
			for (const field of rule.fields) {
				try {
					const element = form.querySelector(field.selector);
					if (element instanceof HTMLInputElement && element.type === 'checkbox') {
						values[field.slug] = element.checked;
					} else if (element instanceof HTMLInputElement && element.type === 'radio') {
						const checked = form.querySelector<HTMLInputElement>(`${field.selector}:checked`);
						if (checked) values[field.slug] = checked.value;
					} else if (
						element instanceof HTMLInputElement ||
						element instanceof HTMLSelectElement ||
						element instanceof HTMLTextAreaElement
					) {
						if (element.value) values[field.slug] = element.value.slice(0, 500);
					}
				} catch {
					// Campo não encontrado: segue com os outros.
				}
			}

			this.track('Rule', rule.id, Object.keys(values).length ? { values } : undefined);
		}
		// O formulário vai sair da página: envia já.
		this.flush();
	};

	/** Consentimento retirado: para de enviar e apaga o identificador. */
	stop(): void {
		this.stopped = true;
		this.queue = [];
		clearTimeout(this.timer);
		document.cookie = `${COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
	}

	private track(name: string, ruleId?: string, lead?: PulseEvent['lead']): void {
		if (this.stopped) return;
		const { utm, fbclid } = attribution();
		this.queue.push({
			id: uuid(),
			name,
			ruleId,
			url: location.href.slice(0, 2048),
			referrer: document.referrer.slice(0, 2048),
			aid: this.aid,
			sid: this.sid,
			utm,
			fbclid,
			lead
		});

		if (this.queue.length >= MAX_BATCH) this.flush();
		else if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
	}

	/** Envia com sendBeacon: não trava a página e sobrevive à saída dela. */
	flush(): void {
		clearTimeout(this.timer);
		this.timer = undefined;

		while (this.queue.length) {
			const events = this.queue.splice(0, MAX_BATCH);
			const url = `${this.api}/t/${this.key}/events`;
			const body = JSON.stringify({ events });

			const sent = navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }));
			if (!sent) {
				void fetch(url, {
					method: 'POST',
					body,
					keepalive: true,
					credentials: 'omit',
					headers: { 'Content-Type': 'text/plain' }
				}).catch(() => {
					// Sem rede: o evento se perde, a página continua normal.
				});
			}
		}
	}
}

(() => {
	const script = document.currentScript as HTMLScriptElement | null;
	if (!script?.src) return;

	const api = (script.dataset.api || __PULSE_API_URL__).replace(/\/+$/, '');
	const token = takeSetupToken();

	if (token) {
		loadEditor(script, api, token);
		return;
	}

	const key = script.dataset.pixel ?? '';
	if (!/^PX_[A-Za-z0-9]{20}$/.test(key)) return;

	const pixel = new Pixel(api, key);
	const window_ = window as unknown as { pulse?: ((...args: Command) => void) & { q?: Command[] } };
	const queued = window_.pulse?.q ?? [];
	const consentRequired = script.dataset.consent === 'required';

	const pulse = (command: string, value?: unknown) => {
		if (command === 'consent' && value === 'granted') pixel.start();
		if (command === 'consent' && value === 'denied') pixel.stop();
	};
	window_.pulse = pulse as typeof window_.pulse;
	for (const [command, value] of queued) pulse(command, value);

	if (!consentRequired) pixel.start();
})();
