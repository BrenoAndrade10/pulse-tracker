export const SECRET = /senha|password|passwd|pin\b|cart[aã]o|card|cvv|cvc|security|seguran[cç]a/i;

const BLOCKED_TYPES = new Set(['password', 'hidden', 'file']);
const BLOCKED_AUTOCOMPLETE = /^(?:cc-[\w-]+|current-password|new-password|one-time-code)$/i;

export function isSensitive(control: Element): boolean {
	const type = control instanceof HTMLInputElement ? control.type : '';
	if (BLOCKED_TYPES.has(type)) return true;

	const autocomplete = control.getAttribute('autocomplete') ?? '';
	if (autocomplete.split(/\s+/).some((token) => BLOCKED_AUTOCOMPLETE.test(token))) return true;

	const labels =
		control instanceof HTMLInputElement ||
		control instanceof HTMLSelectElement ||
		control instanceof HTMLTextAreaElement
			? [...(control.labels ?? [])].map((label) => label.textContent ?? '').join(' ')
			: '';
	const identity = [
		control.getAttribute('name'),
		control.id,
		control.getAttribute('aria-label'),
		control.getAttribute('placeholder'),
		labels
	].join(' ');
	return SECRET.test(identity);
}

export function looksLikeCard(value: string): boolean {
	const digits = value.replace(/[\s.-]/g, '');
	if (!/^\d{13,19}$/.test(digits)) return false;

	let sum = 0;
	for (let i = 0; i < digits.length; i++) {
		let digit = Number(digits[digits.length - 1 - i]);
		if (i % 2) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
	}
	return sum % 10 === 0;
}
