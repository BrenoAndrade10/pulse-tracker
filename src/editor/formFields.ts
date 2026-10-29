/** O que guardar de cada campo do formulário no lead. */
export type FieldKey = 'name' | 'email' | 'phone' | 'consent' | 'custom' | 'skip';

export type DetectedField = {
	/** Seletor do campo dentro do formulário (salvo na regra). */
	selector: string;
	/** Rótulo como aparece para a pessoa (label, placeholder ou name). */
	label: string;
	/** Tipo do controle, para a dica ao lado: e-mail, telefone, caixa... */
	kind: string;
	suggested: FieldKey;
	isCheckbox: boolean;
};

/** Nunca mapeáveis: senhas, cartões e afins não aparecem nem na lista. */
const SECRET = /senha|password|passwd|pin\b|cart[aã]o|card|cvv|cvc|security|seguran[cç]a/i;
const SKIPPED_TYPES = new Set(['password', 'hidden', 'file', 'submit', 'button', 'reset', 'image']);

function labelOf(control: HTMLElement): string {
	const id = control.getAttribute('id');
	const byFor = id ? control.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
	const text =
		byFor?.textContent ||
		control.closest('label')?.textContent ||
		control.getAttribute('aria-label') ||
		control.getAttribute('placeholder') ||
		control.getAttribute('name') ||
		'';
	return text.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Seletor estável do campo dentro do formulário: name, id ou placeholder. */
function selectorOf(control: HTMLElement, form: HTMLFormElement): string | null {
	const tag = control.tagName.toLowerCase();
	const name = control.getAttribute('name');
	const radio = control instanceof HTMLInputElement && control.type === 'radio';

	if (name) {
		const selector = `${tag}[name="${CSS.escape(name)}"]`;
		// Rádios do mesmo grupo dividem o name: o valor vem do marcado.
		if (radio || form.querySelectorAll(selector).length === 1) return selector;
	}
	const id = control.getAttribute('id');
	if (id) return `#${CSS.escape(id)}`;
	const placeholder = control.getAttribute('placeholder');
	if (placeholder) {
		const selector = `${tag}[placeholder="${CSS.escape(placeholder)}"]`;
		if (form.querySelectorAll(selector).length === 1) return selector;
	}
	return null;
}

function suggest(control: HTMLElement, label: string): FieldKey {
	const type = control instanceof HTMLInputElement ? control.type : '';
	const hint = `${label} ${control.getAttribute('name') ?? ''} ${control.getAttribute('autocomplete') ?? ''}`.toLowerCase();

	if (type === 'checkbox') {
		return /concord|aceit|termo|privacidade|lgpd|consent|autorizo/.test(hint) ? 'consent' : 'custom';
	}
	if (type === 'email' || /e-?mail/.test(hint)) return 'email';
	if (type === 'tel' || /\btel|fone|whats|celular|\bcel\b|zap|phone/.test(hint)) return 'phone';
	if (/\bnome\b|\bname\b|given-name|full.?name|seu nome/.test(hint) && !/empresa|usu[aá]rio|user/.test(hint)) {
		return 'name';
	}
	return 'custom';
}

function kindOf(control: HTMLElement): string {
	if (control instanceof HTMLSelectElement) return 'lista';
	if (control instanceof HTMLTextAreaElement) return 'texto longo';
	const type = (control as HTMLInputElement).type;
	return (
		{ email: 'e-mail', tel: 'telefone', checkbox: 'caixa de marcar', radio: 'opções', number: 'número', date: 'data', url: 'link' }[type] ??
		'texto'
	);
}

/** Campos que podem ir para o lead, na ordem do formulário. */
export function detectFields(form: HTMLFormElement): DetectedField[] {
	const fields: DetectedField[] = [];
	const seen = new Set<string>();

	for (const control of Array.from(form.elements)) {
		if (
			!(control instanceof HTMLInputElement) &&
			!(control instanceof HTMLSelectElement) &&
			!(control instanceof HTMLTextAreaElement)
		) {
			continue;
		}
		if (control instanceof HTMLInputElement && SKIPPED_TYPES.has(control.type)) continue;

		const autocomplete = control.getAttribute('autocomplete') ?? '';
		const label = labelOf(control);
		const identity = `${label} ${control.getAttribute('name') ?? ''} ${control.getAttribute('id') ?? ''}`;
		if (autocomplete.startsWith('cc-') || SECRET.test(identity)) continue;

		const selector = selectorOf(control, form);
		if (!selector || seen.has(selector)) continue;
		seen.add(selector);

		fields.push({
			selector,
			label: label || 'Campo sem nome',
			kind: kindOf(control),
			suggested: suggest(control, label),
			isCheckbox: control instanceof HTMLInputElement && control.type === 'checkbox'
		});
	}

	// Só um campo de cada tipo principal: o segundo e-mail vira personalizado.
	const taken = new Set<FieldKey>();
	for (const field of fields) {
		if (field.suggested === 'custom' || field.suggested === 'skip') continue;
		if (taken.has(field.suggested)) field.suggested = 'custom';
		else taken.add(field.suggested);
	}

	return fields.slice(0, 20);
}

/** Identificador do campo no envio: o tipo, ou o rótulo simplificado para personalizados. */
export function slugFor(key: FieldKey, label: string, used: Set<string>): string {
	let base =
		key === 'custom'
			? label
					.normalize('NFD')
					.replace(/\p{M}/gu, '')
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '_')
					.replace(/^_+|_+$/g, '')
					.replace(/^(\d)/, 'campo_$1')
					.slice(0, 30) || 'campo'
			: key;
	if (!/^[a-z]/.test(base)) base = `campo_${base}`;

	let slug = base;
	for (let i = 2; used.has(slug); i++) slug = `${base}_${i}`;
	used.add(slug);
	return slug;
}
