import { isSensitive, looksLikeCard } from './sensitive';

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
	pl?: string;
	fbp?: string;
	fbc?: string;
	lead?: { values: Record<string, string | boolean> };
	eng?: { t: number; s: number };
};
type Attribution = {
	utm: Record<string, string>;
	fbclid?: string;
	pl?: string;
	fbc?: string;
	fbclidCapturedAt?: number;
};
type Command = [string, ...unknown[]];

const SETUP_PARAM = 'pulse_setup';
const SETUP_STORAGE_KEY = 'pulse:setup';
const TOKEN_PATTERN = /^[\w-]{43}$/;
const COOKIE = '_pulse_id';
const MAX_BATCH = 20;
const FLUSH_MS = 2000;
const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term'];
const ATTRIBUTION_STORAGE_KEY = 'pulse:attribution';
const PULSE_LINK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ACTIVE_WINDOW_MS = 10000;
const SCROLL_THROTTLE_MS = 200;
const MIN_ENGAGED_SECONDS = 2;
const ACTIVITY_EVENTS = ['scroll', 'click', 'keydown', 'pointermove', 'touchstart'] as const;
const META_COOKIE_VALUE = /^[A-Za-z0-9._:-]+$/;

function takeSetupToken(): string | null {
	const match = new RegExp(`(?:^#|&)${SETUP_PARAM}=([\\w-]+)`).exec(location.hash);

	if (match && TOKEN_PATTERN.test(match[1])) {
		try {
			sessionStorage.setItem(SETUP_STORAGE_KEY, match[1]);
		} catch {
			//
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

function anonymousId(): string {
	const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([\\w-]+)`));
	if (match) return match[1];

	const id = uuid();
	document.cookie = `${COOKIE}=${id}; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
	return id;
}

function cookie(name: string, max: number): string {
	try {
		const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
		const value = match?.[1] ?? '';
		return value.length <= max && META_COOKIE_VALUE.test(value) ? value : '';
	} catch {
		return '';
	}
}

function attribution(): Attribution & { fbp?: string } {
	const params = new URLSearchParams(location.search);
	const current: Attribution = { utm: {} };
	for (const key of UTM_KEYS) {
		const value = params.get(`utm_${key}`);
		if (value) current.utm[key] = value.slice(0, 200);
	}
	const fbclid = params.get('fbclid');
	if (fbclid) current.fbclid = fbclid.slice(0, 500);
	const pl = params.get('pl');
	if (pl && PULSE_LINK_ID.test(pl)) current.pl = pl;

	let stored: Attribution | null = null;
	try {
		const value = sessionStorage.getItem(ATTRIBUTION_STORAGE_KEY);
		if (value) stored = JSON.parse(value) as Attribution;
	} catch {
		//
	}

	const result: Attribution = stored
		? { ...stored, utm: stored.utm ?? {} }
		: { utm: current.utm, fbclid: current.fbclid };
	let changed = !stored && (Object.keys(current.utm).length > 0 || Boolean(current.fbclid));
	if (current.pl) {
		result.pl = current.pl;
		changed = true;
	}

	const fbp = cookie('_fbp', 100);
	const cookieFbc = cookie('_fbc', 200);
	if (cookieFbc) result.fbc = cookieFbc;
	else if (!result.fbc && result.fbclid) {
		const timestamp = result.fbclidCapturedAt ?? Date.now();
		const calculated = `fb.1.${timestamp}.${result.fbclid}`;
		if (calculated.length <= 200 && META_COOKIE_VALUE.test(calculated)) {
			result.fbc = calculated;
			result.fbclidCapturedAt = timestamp;
			changed = true;
		}
	}

	if (changed) {
		try {
			sessionStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(result));
		} catch {
			//
		}
	}

	return { ...result, fbp };
}

class Pixel {
	private queue: PulseEvent[] = [];
	private timer: ReturnType<typeof setTimeout> | undefined;
	private rules: Rule[] = [];
	private readonly rulesByPage = new Map<string, Rule[]>();
	private lastPage = '';
	private started = false;
	private stopped = false;
	private aid = '';
	private pageHref = '';
	private activeMs = 0;
	private maxScroll = 0;
	private sentScroll = 0;
	private lastTick = 0;
	private lastActivity = 0;
	private lastScrollAt = 0;
	private readonly sid = session('pulse:sid', uuid);

	constructor(
		private readonly api: string,
		private readonly key: string
	) {}

	start(): void {
		this.stopped = false;
		if (this.started) return;
		this.started = true;
		this.aid = anonymousId();

		addEventListener('click', this.onClick, { capture: true, passive: true });
		document.addEventListener('submit', this.onSubmit, { capture: true });
		addEventListener('pagehide', () => {
			this.sendEngaged(true);
			this.flush();
		});
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'hidden') {
				this.sendEngaged(true);
				this.flush();
			} else {
				const now = Date.now();
				this.lastTick = now;
				this.lastActivity = now;
			}
		});
		for (const name of ACTIVITY_EVENTS) {
			addEventListener(name, () => this.onActivity(name), { capture: true, passive: true });
		}

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

	private resetEngagement(): void {
		const now = Date.now();
		this.pageHref = location.href.slice(0, 2048);
		this.activeMs = 0;
		this.maxScroll = 0;
		this.sentScroll = 0;
		this.lastTick = now;
		this.lastActivity = now;
	}

	private account(now: number): void {
		if (document.visibilityState === 'visible') {
			const until = Math.min(now, this.lastActivity + ACTIVE_WINDOW_MS);
			if (until > this.lastTick) this.activeMs += until - this.lastTick;
		}
		this.lastTick = now;
	}

	private measureScroll(): void {
		try {
			const root = document.documentElement;
			const total = Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0);
			const height = innerHeight;
			const depth =
				total <= height ? 100 : Math.floor(((scrollY + height) / total) * 100);
			const value = Math.min(100, Math.max(0, depth));
			if (value > this.maxScroll) this.maxScroll = value;
		} catch {
			//
		}
	}

	private onActivity(name: (typeof ACTIVITY_EVENTS)[number]): void {
		try {
			const now = Date.now();
			this.account(now);
			this.lastActivity = now;
			if (name === 'scroll' && now - this.lastScrollAt >= SCROLL_THROTTLE_MS) {
				this.lastScrollAt = now;
				this.measureScroll();
			}
		} catch {
			//
		}
	}

	private sendEngaged(measure: boolean): void {
		try {
			if (this.stopped || !this.pageHref) return;
			this.account(Date.now());
			if (measure) this.measureScroll();
			const seconds = Math.min(1800, Math.floor(this.activeMs / 1000));
			if (seconds < MIN_ENGAGED_SECONDS && this.maxScroll <= this.sentScroll) return;
			this.track('Engaged', undefined, undefined, {
				url: this.pageHref,
				eng: { t: seconds, s: this.maxScroll }
			});
			this.activeMs = 0;
			this.sentScroll = this.maxScroll;
		} catch {
			//
		}
	}

	private pageUrl(): string {
		return `${location.origin}${location.pathname}`;
	}

	private pageView(): void {
		const page = this.pageUrl();
		if (page === this.lastPage) return;
		if (this.lastPage) {
			this.sendEngaged(false);
			this.flush();
		}
		this.lastPage = page;
		this.resetEngagement();
		this.loadRules(page);
		this.track('PageView');
	}

	private loadRules(page: string): void {
		const cached = this.rulesByPage.get(page);
		if (cached) {
			this.rules = cached;
			return;
		}

		void fetch(`${this.api}/t/${this.key}/config?page=${encodeURIComponent(page)}`, { credentials: 'omit' })
			.then((response) => (response.ok ? (response.json() as Promise<{ rules: Rule[] }>) : null))
			.then((config) => {
				if (!config) return;
				this.rulesByPage.set(page, config.rules);
				if (page === this.lastPage) this.rules = config.rules;
			})
			.catch(() => {

			});
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
				// 
			}
		}
		if (matched) this.flush();
	};

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

					if (!element || isSensitive(element)) continue;

					if (element instanceof HTMLInputElement && element.type === 'checkbox') {
						values[field.slug] = element.checked;
					} else if (element instanceof HTMLInputElement && element.type === 'radio') {
						const checked = form.querySelector<HTMLInputElement>(`${field.selector}:checked`);
						if (checked && !isSensitive(checked)) values[field.slug] = checked.value;
					} else if (
						element instanceof HTMLInputElement ||
						element instanceof HTMLSelectElement ||
						element instanceof HTMLTextAreaElement
					) {
						if (field.key === 'custom' && looksLikeCard(element.value)) continue;
						if (element.value) values[field.slug] = element.value.slice(0, 500);
					}
				} catch {
					// Campo não encontrado: segue com os outros.
				}
			}

			this.track('Rule', rule.id, Object.keys(values).length ? { values } : undefined);
		}
		this.flush();
	};

	stop(): void {
		this.stopped = true;
		this.queue = [];
		clearTimeout(this.timer);
		document.cookie = `${COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
	}

	private track(
		name: string,
		ruleId?: string,
		lead?: PulseEvent['lead'],
		engaged?: { url: string; eng: NonNullable<PulseEvent['eng']> }
	): void {
		if (this.stopped) return;
		const { utm, fbclid, pl, fbp, fbc } = attribution();
		const event: PulseEvent = {
			id: uuid(),
			name,
			ruleId,
			url: engaged?.url ?? location.href.slice(0, 2048),
			referrer: document.referrer.slice(0, 2048),
			aid: this.aid,
			sid: this.sid,
			utm,
			fbclid,
			lead,
		};
		if (engaged) event.eng = engaged.eng;
		if (pl) event.pl = pl;
		if (fbp) event.fbp = fbp;
		if (fbc) event.fbc = fbc;
		this.queue.push(event);

		if (this.queue.length >= MAX_BATCH) this.flush();
		else if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
	}

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
					// 
				});
			}
		}
	}
}

(() => {
	const script = document.currentScript as HTMLScriptElement | null;
	if (!script?.src) return;

	const token = takeSetupToken();

	if (token) {
		loadEditor(script, __PULSE_API_URL__, token);
		return;
	}

	const api = (script.dataset.api || __PULSE_API_URL__).replace(/\/+$/, '');

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
