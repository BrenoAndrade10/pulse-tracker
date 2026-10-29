import {
	actionableElement,
	findElement,
	fingerprint,
	isForm,
	visibleText,
	type ElementFingerprint
} from '../fingerprint';
import { SetupApi, SetupApiError, type RuleField, type RuleScope, type TrackingRule } from './api';
import { detectFields, slugFor, type FieldKey } from './formFields';
import { CUSTOM_EVENT, CUSTOM_EVENT_PATTERN, eventLabel, STANDARD_EVENTS } from './events';
import { EDITOR_CSS } from './styles';

type Child = Node | string | null | undefined | false;
type Props = Record<string, string | number | boolean | EventListener | undefined>;

/**
 * Cria elementos do editor. Texto vindo da página (ex.: o texto de um botão)
 * entra sempre como texto, nunca como HTML.
 */
function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props: Props = {},
	...children: Child[]
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	for (const [name, value] of Object.entries(props)) {
		if (value === undefined || value === false) continue;
		if (typeof value === 'function') element.addEventListener(name.slice(2), value);
		else if (name === 'class') element.className = String(value);
		else if (value === true) element.setAttribute(name, '');
		else element.setAttribute(name, String(value));
	}
	for (const child of children) {
		if (child !== null && child !== undefined && child !== false) element.append(child);
	}
	return element;
}

/** Bloqueados na página só enquanto se escolhe um elemento: clicar em "Comprar" não pode comprar. */
const BLOCKED_EVENTS = [
	'click',
	'dblclick',
	'auxclick',
	'contextmenu',
	'mousedown',
	'mouseup',
	'pointerdown',
	'pointerup',
	'submit'
];

function guessEvent(element: Element): string {
	const text = `${visibleText(element) ?? ''} ${element.getAttribute('href') ?? ''}`.toLowerCase();
	if (/wa\.me|whatsapp|tel:|mailto:/.test(text)) return 'Contact';
	if (/carrinho/.test(text)) return 'AddToCart';
	if (/comprar|compre|pagar|checkout|finalizar/.test(text)) return 'InitiateCheckout';
	if (/agendar|agende|marcar/.test(text)) return 'Schedule';
	return 'Lead';
}

function describe(element: ElementFingerprint): string {
	return element.text || element.attributes.name || element.attributes['aria-label'] || element.selector;
}

class Editor {
	private readonly host = document.createElement('pulse-editor');
	private readonly root = this.host.attachShadow({ mode: 'closed' });
	private readonly highlight = h('div', { class: 'highlight', hidden: true });
	private readonly highlightLabel = h('span', { class: 'highlight-label' });
	private readonly markers = h('div');
	private readonly status = h('span', { class: 'status' }, 'Conectando ao Pulse…');
	private readonly selectButton = h('button', { class: 'btn primary', type: 'button', disabled: true });
	private readonly rulesButton = h('button', { class: 'btn', type: 'button', disabled: true });
	private readonly panelSlot = h('div');
	private readonly toastSlot = h('div');

	private rules: TrackingRule[] = [];
	private pageUrl = '';
	private selecting = false;
	private hovered: Element | null = null;
	private pending: { element: Element; fingerprint: ElementFingerprint } | null = null;
	private panel: 'none' | 'new' | 'list' | 'expired' = 'none';
	private frame = 0;
	private toastTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly observer = new MutationObserver(() => this.schedule());

	constructor(
		private readonly api: SetupApi,
		private readonly storageKey: string
	) {}

	mount(): void {
		const sheet = new CSSStyleSheet();
		try {
			sheet.replaceSync(EDITOR_CSS);
			this.root.adoptedStyleSheets = [sheet];
		} catch {
			this.root.append(h('style', {}, EDITOR_CSS));
		}

		this.highlight.append(this.highlightLabel);
		this.selectButton.addEventListener('click', () => this.toggleSelecting());
		this.rulesButton.addEventListener('click', () => this.openPanel(this.panel === 'list' ? 'none' : 'list'));

		this.root.append(
			h('div', { class: 'layer' }, this.markers, this.highlight),
			h(
				'div',
				{ class: 'toolbar', role: 'toolbar', 'aria-label': 'Editor de eventos do Pulse' },
				h('span', { class: 'brand' }, h('span', { class: 'brand-dot', 'aria-hidden': 'true' }), 'Pulse'),
				this.status,
				this.selectButton,
				this.rulesButton,
				h(
					'button',
					{
						class: 'btn ghost icon',
						type: 'button',
						'aria-label': 'Sair do modo de configuração',
						title: 'Sair do modo de configuração',
						onclick: () => this.exit()
					},
					'✕'
				)
			),
			this.panelSlot,
			this.toastSlot
		);
		document.documentElement.append(this.host);

		window.addEventListener('pointermove', this.onPointerMove, true);
		window.addEventListener('keydown', this.onKeyDown, true);
		window.addEventListener('scroll', this.schedule, { capture: true, passive: true });
		window.addEventListener('resize', this.schedule, { passive: true });
		for (const type of BLOCKED_EVENTS) {
			window.addEventListener(type, this.onBlocked, { capture: true, passive: false });
		}
		this.observer.observe(document.body, { childList: true, subtree: true });

		this.renderToolbar();
	}

	async start(): Promise<void> {
		try {
			const session = await this.api.openSession();
			this.rules = session.rules;
			this.pageUrl = session.pageUrl;
			this.status.textContent = 'Clique em "Selecionar elemento" para criar um evento';
			this.selectButton.disabled = false;
			this.rulesButton.disabled = false;
		} catch (error) {
			if (error instanceof SetupApiError && (error.status === 401 || error.status === 403)) {
				this.forgetToken();
				this.status.textContent = 'Link de configuração expirado';
				this.openPanel('expired');
			} else {
				this.status.textContent = 'Sem conexão com o Pulse. Recarregue a página.';
			}
		}
		this.renderToolbar();
		this.schedule();
	}

	// ── Seleção ────────────────────────────────────────────────────────────

	private isOwn(event: Event): boolean {
		return event.composedPath().includes(this.host);
	}

	private toggleSelecting(force?: boolean): void {
		this.selecting = force ?? !this.selecting;
		this.hovered = null;
		if (this.selecting) {
			this.pending = null;
			if (this.panel === 'new') this.openPanel('none');
		}
		this.status.textContent = this.selecting
			? 'Clique no botão, link ou formulário que você quer medir (Esc cancela)'
			: 'Clique em "Selecionar elemento" para criar um evento';
		this.renderToolbar();
		this.schedule();
	}

	private readonly onPointerMove = (event: PointerEvent): void => {
		if (!this.selecting || this.isOwn(event)) return;
		const target = event.target instanceof Element ? event.target : null;
		const next = target ? actionableElement(target) : null;
		if (next !== this.hovered) {
			this.hovered = next;
			this.schedule();
		}
	};

	private readonly onBlocked = (event: Event): void => {
		if (!this.selecting || this.isOwn(event)) return;
		event.preventDefault();
		event.stopImmediatePropagation();

		if (event.type === 'click' && event.target instanceof Element) {
			this.choose(actionableElement(event.target));
		}
	};

	private readonly onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		if (this.selecting) this.toggleSelecting(false);
		else if (this.panel !== 'none' && this.panel !== 'expired') this.openPanel('none');
		else return;
		event.stopImmediatePropagation();
	};

	private choose(element: Element): void {
		this.selecting = false;
		this.hovered = null;
		this.pending = { element, fingerprint: fingerprint(element) };
		this.status.textContent = 'Escolha o evento deste elemento';
		this.renderToolbar();
		this.openPanel('new');
	}

	// ── Desenho sobre a página ─────────────────────────────────────────────

	private readonly schedule = (): void => {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.renderOverlay();
		});
	};

	private place(box: HTMLElement, rect: DOMRect): void {
		box.style.top = `${rect.top - 3}px`;
		box.style.left = `${rect.left - 3}px`;
		box.style.width = `${rect.width + 6}px`;
		box.style.height = `${rect.height + 6}px`;
	}

	private renderOverlay(): void {
		const target = this.selecting ? this.hovered : (this.pending?.element ?? null);

		if (target && target.isConnected) {
			const rect = target.getBoundingClientRect();
			this.place(this.highlight, rect);
			this.highlight.classList.toggle('locked', !this.selecting);
			this.highlightLabel.classList.toggle('below', rect.top < 34);
			const text = visibleText(target);
			this.highlightLabel.textContent = isForm(target)
				? 'Formulário'
				: `${target.tagName.toLowerCase()}${text ? ` · ${text}` : ''}`;
			this.highlight.hidden = false;
		} else {
			this.highlight.hidden = true;
		}

		this.markers.replaceChildren(
			...this.rules.flatMap((rule) => {
				const element = findElement(rule.element);
				if (!element) return [];
				const marker = h('div', { class: 'marker' }, h('span', { class: 'marker-label' }, eventLabel(rule.eventName)));
				this.place(marker, element.getBoundingClientRect());
				return [marker];
			})
		);
	}

	private renderToolbar(): void {
		this.selectButton.textContent = this.selecting ? 'Cancelar seleção' : 'Selecionar elemento';
		this.selectButton.className = this.selecting ? 'btn active' : 'btn primary';
		this.selectButton.setAttribute('aria-pressed', String(this.selecting));
		this.rulesButton.replaceChildren('Eventos', h('span', { class: 'count' }, String(this.rules.length)));
		this.rulesButton.setAttribute('aria-expanded', String(this.panel === 'list'));
	}

	// ── Painel ─────────────────────────────────────────────────────────────

	private openPanel(panel: Editor['panel']): void {
		if (panel !== 'new') this.pending = null;
		this.panel = panel;
		this.renderToolbar();
		this.schedule();

		if (panel === 'none') {
			this.panelSlot.replaceChildren();
			return;
		}

		const content =
			panel === 'new' ? this.newRulePanel() : panel === 'list' ? this.rulesPanel() : this.expiredPanel();
		this.panelSlot.replaceChildren(content);
		content.querySelector<HTMLElement>('select, input, button.primary')?.focus();
	}

	private header(title: string, subtitle?: string): HTMLElement {
		return h(
			'div',
			{ class: 'panel-header' },
			h('div', { class: 'grow' }, h('h2', {}, title), subtitle ? h('p', {}, subtitle) : null),
			h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': 'Fechar', onclick: () => this.openPanel('none') }, '✕')
		);
	}

	private newRulePanel(): HTMLElement {
		const pending = this.pending!;
		const form = isForm(pending.element);
		const existing = this.rules.filter((rule) => rule.element.selector === pending.fingerprint.selector);
		const suggested = guessEvent(pending.element);

		const select = h(
			'select',
			{ class: 'field', id: 'pulse-event', 'aria-describedby': 'pulse-event-hint' },
			...STANDARD_EVENTS.map((event) => h('option', { value: event.name, selected: event.name === suggested }, event.label)),
			h('option', { value: CUSTOM_EVENT }, 'Outro (nome personalizado)')
		);
		const eventHint = h('p', { class: 'hint', id: 'pulse-event-hint' });
		const customInput = h('input', {
			class: 'field',
			id: 'pulse-custom',
			placeholder: 'Ex.: CliqueBotaoBonus',
			maxlength: 40,
			autocomplete: 'off',
			spellcheck: 'false'
		});
		const customField = h(
			'div',
			{ hidden: true },
			h('label', { class: 'label', for: 'pulse-custom' }, 'Nome do evento'),
			customInput,
			h('p', { class: 'hint' }, 'Letras, números e _ (até 40). Ex.: CliqueBotaoBonus')
		);
		const error = h('p', { class: 'error', role: 'alert', hidden: true });
		const saveButton = h('button', { class: 'btn primary', type: 'submit' }, 'Salvar evento');
		const fieldsSection = form ? this.fieldsSection(pending.element as HTMLFormElement) : null;

		// Clicou no "Enviar" de um formulário: para o lead, o que importa é o envio.
		const parentForm =
			!form && pending.element.matches('button:not([type]), button[type="submit"], input[type="submit"]')
				? pending.element.closest('form')
				: null;

		const syncEvent = () => {
			const custom = select.value === CUSTOM_EVENT;
			customField.hidden = !custom;
			eventHint.textContent = custom ? '' : (STANDARD_EVENTS.find((e) => e.name === select.value)?.hint ?? '');
		};
		select.addEventListener('change', () => {
			syncEvent();
			if (select.value === CUSTOM_EVENT) customInput.focus();
		});
		syncEvent();

		const scopeChoice = (value: RuleScope, title: string, detail: string, checked: boolean) =>
			h(
				'label',
				{ class: 'choice' },
				h('input', { type: 'radio', name: 'pulse-scope', value, checked }),
				h('span', {}, title, h('small', {}, detail))
			);
		const pagePath = (() => {
			try {
				return new URL(this.pageUrl).pathname;
			} catch {
				return location.pathname;
			}
		})();

		const panel = h(
			'form',
			{
				class: 'panel',
				role: 'dialog',
				'aria-label': 'Novo evento',
				novalidate: true,
				onsubmit: (event: Event) => {
					event.preventDefault();
					void save();
				}
			},
			this.header('Novo evento', form ? 'Conta quando o formulário for enviado.' : 'Conta quando o elemento for clicado.'),
			h(
				'div',
				{ class: 'panel-body' },
				h(
					'div',
					{ class: 'element-card' },
					h('span', { class: 'tag' }, form ? 'form' : pending.fingerprint.tag),
					h('span', { class: 'element-text' }, form ? 'Formulário' : describe(pending.fingerprint))
				),
				existing.length
					? h('p', { class: 'notice' }, `Este elemento já conta: ${existing.map((rule) => eventLabel(rule.eventName)).join(', ')}.`)
					: null,
				parentForm
					? h(
							'div',
							{ class: 'tip' },
							h('p', {}, 'Este botão envia um formulário. Para salvar nome, e-mail e telefone como lead, meça o envio do formulário.'),
							h(
								'button',
								{ class: 'btn', type: 'button', onclick: () => this.choose(parentForm) },
								'Medir o envio do formulário'
							)
						)
					: null,
				h('div', {}, h('label', { class: 'label', for: 'pulse-event' }, 'Evento'), select, eventHint),
				customField,
				fieldsSection?.element ?? null,
				h(
					'fieldset',
					{ class: 'plain' },
					h('legend', { class: 'label' }, 'Onde vale'),
					h(
						'div',
						{ class: 'choices' },
						scopeChoice('page', 'Só nesta página', pagePath, true),
						scopeChoice('site', 'Em todas as páginas do site', 'Ex.: um botão do menu ou do rodapé', false)
					)
				),
				error
			),
			h(
				'div',
				{ class: 'panel-footer' },
				h('button', { class: 'btn ghost', type: 'button', onclick: () => this.openPanel('none') }, 'Cancelar'),
				saveButton
			)
		);

		const save = async () => {
			error.hidden = true;
			const eventName = select.value === CUSTOM_EVENT ? customInput.value.trim() : select.value;
			if (!CUSTOM_EVENT_PATTERN.test(eventName)) {
				error.textContent = 'Use só letras, números e _ no nome do evento, começando por uma letra.';
				error.hidden = false;
				customInput.focus();
				return;
			}
			const scope = (panel.querySelector<HTMLInputElement>('input[name="pulse-scope"]:checked')?.value ?? 'page') as RuleScope;
			const fields = fieldsSection ? fieldsSection.collect() : [];
			if (typeof fields === 'string') {
				error.textContent = fields;
				error.hidden = false;
				return;
			}

			saveButton.disabled = true;
			saveButton.textContent = 'Salvando…';
			try {
				const rule = await this.api.createRule({
					scope,
					trigger: form ? 'submit' : 'click',
					eventName,
					element: pending.fingerprint,
					fields
				});
				this.rules.push(rule);
				this.openPanel('none');
				this.status.textContent = 'Clique em "Selecionar elemento" para criar outro evento';
				this.toast(`Evento "${eventLabel(eventName)}" salvo`);
			} catch (caught) {
				error.textContent =
					caught instanceof SetupApiError && caught.messages.length
						? caught.messages.join(' ')
						: caught instanceof SetupApiError && caught.status === 401
							? 'O link de configuração expirou. Gere outro no Pulse.'
							: 'Não foi possível salvar. Tente novamente.';
				error.hidden = false;
				saveButton.disabled = false;
				saveButton.textContent = 'Salvar evento';
			}
		};

		return panel;
	}

	/**
	 * Campos do formulário e o que guardar de cada um no lead. Senhas e dados
	 * de cartão nem aparecem (ver detectFields).
	 */
	private fieldsSection(formElement: HTMLFormElement): {
		element: HTMLElement;
		collect: () => RuleField[] | string;
	} {
		const STANDARD_LABELS: Record<Exclude<FieldKey, 'custom' | 'skip'>, string> = {
			name: 'Nome',
			email: 'E-mail',
			phone: 'Telefone',
			consent: 'Consentimento'
		};
		const detected = detectFields(formElement);
		const warning = h('p', { class: 'warning', hidden: true }, 'Sem e-mail nem telefone, o envio conta como evento, mas não vira lead.');

		const rows = detected.map((field, index) => {
			const options: [FieldKey, string][] = field.isCheckbox
				? [['consent', 'Consentimento (LGPD)'], ['custom', 'Personalizado'], ['skip', 'Não salvar']]
				: [['name', 'Nome'], ['email', 'E-mail'], ['phone', 'Telefone'], ['custom', 'Personalizado'], ['skip', 'Não salvar']];
			const select = h(
				'select',
				{ class: 'field compact', id: `pulse-field-${index}`, 'aria-label': `O que é "${field.label}"` },
				...options.map(([value, text]) => h('option', { value, selected: value === field.suggested }, text))
			);
			const customLabel = h('input', {
				class: 'field compact',
				value: field.label,
				maxlength: 80,
				'aria-label': `Nome da coluna para "${field.label}"`,
				placeholder: 'Nome da coluna no CSV'
			});
			const syncRow = () => {
				customLabel.hidden = select.value !== 'custom';
				const keys = selects.map((item) => item.value);
				warning.hidden = keys.includes('email') || keys.includes('phone');
			};
			select.addEventListener('change', syncRow);

			const element = h(
				'li',
				{ class: 'field-row' },
				h('label', { class: 'field-name', for: `pulse-field-${index}` }, field.label, h('small', {}, field.kind)),
				h('div', { class: 'field-controls' }, select, customLabel)
			);
			return { field, select, customLabel, element, syncRow };
		});
		const selects = rows.map((row) => row.select);
		rows.forEach((row) => row.syncRow());

		const element = h(
			'section',
			{ class: 'fields' },
			h('h3', { class: 'label' }, 'Campos para salvar no lead'),
			rows.length
				? h('ul', { class: 'field-list' }, ...rows.map((row) => row.element))
				: h('p', { class: 'hint' }, 'Nenhum campo que possa ser salvo foi encontrado neste formulário.'),
			warning,
			h('p', { class: 'hint' }, 'Senhas e dados de cartão nunca são lidos. Os dados ficam cifrados e só a sua empresa acessa.')
		);

		const collect = (): RuleField[] | string => {
			const used = new Set<string>();
			const counts = new Map<string, number>();
			const fields: RuleField[] = [];

			for (const row of rows) {
				const key = row.select.value as FieldKey;
				if (key === 'skip') continue;
				counts.set(key, (counts.get(key) ?? 0) + 1);
				if (key !== 'custom' && counts.get(key)! > 1) {
					return `Escolha "${STANDARD_LABELS[key]}" para um campo só.`;
				}

				const label = key === 'custom' ? row.customLabel.value.replace(/\s+/g, ' ').trim() : STANDARD_LABELS[key];
				if (!label) return 'Dê um nome a cada campo personalizado.';

				fields.push({ key, slug: slugFor(key, label, used), label: label.slice(0, 80), selector: row.field.selector });
			}
			return fields;
		};

		return { element, collect };
	}

	private rulesPanel(): HTMLElement {
		const list = this.rules.length
			? h('ul', { class: 'rules' }, ...this.rules.map((rule) => this.ruleItem(rule)))
			: h('p', { class: 'empty' }, 'Nenhum evento nesta página ainda.');

		return h(
			'div',
			{ class: 'panel', role: 'dialog', 'aria-label': 'Eventos desta página' },
			this.header('Eventos desta página', 'Os contornos verdes mostram onde cada um está.'),
			h('div', { class: 'panel-body' }, list),
			h(
				'div',
				{ class: 'panel-footer' },
				h('button', { class: 'btn primary', type: 'button', onclick: () => this.toggleSelecting(true) }, 'Adicionar evento')
			)
		);
	}

	private ruleItem(rule: TrackingRule): HTMLElement {
		const found = Boolean(findElement(rule.element));
		const remove = h('button', { class: 'btn ghost danger', type: 'button' }, 'Excluir');
		let confirming = false;

		remove.addEventListener('click', async () => {
			if (!confirming) {
				confirming = true;
				remove.textContent = 'Confirmar';
				return;
			}
			remove.disabled = true;
			try {
				await this.api.deleteRule(rule.id);
				this.rules = this.rules.filter((item) => item.id !== rule.id);
				this.openPanel('list');
				this.toast('Evento excluído');
			} catch {
				remove.disabled = false;
				this.toast('Não foi possível excluir. Tente novamente.');
			}
		});

		return h(
			'li',
			{ class: 'rule' },
			h(
				'div',
				{ class: 'rule-main' },
				h('div', { class: 'rule-title' }, eventLabel(rule.eventName)),
				h(
					'div',
					{ class: found ? 'rule-meta' : 'rule-meta rule-missing' },
					found
						? `${rule.trigger === 'submit' ? 'Envio' : 'Clique'} · ${describe(rule.element)} · ${rule.scope === 'site' ? 'site todo' : 'esta página'}`
						: 'Elemento não encontrado nesta página'
				)
			),
			remove
		);
	}

	private expiredPanel(): HTMLElement {
		return h(
			'div',
			{ class: 'panel', role: 'dialog', 'aria-label': 'Link expirado' },
			this.header('Link de configuração expirado'),
			h(
				'div',
				{ class: 'panel-body' },
				h('p', {}, 'Por segurança, o link vale por pouco tempo. Volte ao Pulse e clique em "Abrir e configurar" de novo.')
			),
			h('div', { class: 'panel-footer' }, h('button', { class: 'btn primary', type: 'button', onclick: () => this.exit() }, 'Fechar editor'))
		);
	}

	private toast(message: string): void {
		clearTimeout(this.toastTimer);
		this.toastSlot.replaceChildren(h('div', { class: 'toast', role: 'status' }, message));
		this.toastTimer = setTimeout(() => this.toastSlot.replaceChildren(), 2600);
	}

	// ── Saída ──────────────────────────────────────────────────────────────

	private forgetToken(): void {
		try {
			sessionStorage.removeItem(this.storageKey);
		} catch {
			// Sem sessionStorage: nada guardado.
		}
	}

	private exit(): void {
		this.forgetToken();
		this.observer.disconnect();
		cancelAnimationFrame(this.frame);
		window.removeEventListener('pointermove', this.onPointerMove, true);
		window.removeEventListener('keydown', this.onKeyDown, true);
		window.removeEventListener('scroll', this.schedule, true);
		window.removeEventListener('resize', this.schedule);
		for (const type of BLOCKED_EVENTS) window.removeEventListener(type, this.onBlocked, true);
		this.host.remove();
	}
}

(() => {
	const script = document.currentScript as HTMLScriptElement | null;
	const api = script?.dataset.api;
	const token = script?.dataset.token;
	if (!script || !api || !token) return;

	const start = () => {
		const editor = new Editor(new SetupApi(api, token), script.dataset.storageKey ?? 'pulse:setup');
		editor.mount();
		void editor.start();
	};

	if (document.body) start();
	else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
