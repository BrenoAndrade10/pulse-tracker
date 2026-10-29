export type ElementFingerprint = {
	selector: string;
	tag: string;
	text?: string;
	attributes: Record<string, string>;
};

const ACTIONABLE =
	'a[href], button, input[type="submit"], input[type="button"], input[type="image"], [role="button"], summary, label[for]';

const TEST_ATTRIBUTES = [
	'data-testid',
	'data-test',
	'data-test-id',
	'data-cy',
	'data-qa',
	'data-track',
	'data-tracking',
	'data-action'
];

const CAPTURED_ATTRIBUTES = ['id', 'name', 'type', 'href', 'aria-label', 'role', ...TEST_ATTRIBUTES];

const MAX_TEXT = 120;

const MAX_ATTRIBUTES = 10;
const MAX_PATH_DEPTH = 5;

export function isStableToken(value: string): boolean {
	return (
		value.length > 0 &&
		value.length <= 40 &&
		!/\d{3,}/.test(value) &&
		!/[a-f0-9]{6,}/i.test(value) &&
		!/^(css|sc|jsx|svelte|ember|emotion|tw|_)-?/i.test(value) &&
		!/^[a-z]{1,3}\d/i.test(value)
	);
}

export function actionableElement(target: Element): Element {
	return target.closest(ACTIONABLE) ?? target.closest('form') ?? target;
}

export function isForm(element: Element): element is HTMLFormElement {
	return element.tagName === 'FORM';
}

export function visibleText(element: Element): string | undefined {
	const raw =
		element instanceof HTMLInputElement
			? element.value || element.getAttribute('aria-label') || ''
			: (element as HTMLElement).innerText ?? element.textContent ?? '';
	const text = raw.replace(/\s+/g, ' ').trim();
	return text ? text.slice(0, MAX_TEXT) : undefined;
}

const attr = (name: string, value: string) => `[${name}="${CSS.escape(value)}"]`;

function isUnique(selector: string, element: Element): boolean {
	try {
		const matches = document.querySelectorAll(selector);
		return matches.length === 1 && matches[0] === element;
	} catch {
		return false;
	}
}

function stableClasses(element: Element): string[] {
	return [...element.classList].filter(isStableToken).slice(0, 2);
}

function segment(element: Element): string {
	const tag = element.tagName.toLowerCase();
	const classes = stableClasses(element)
		.map((name) => `.${CSS.escape(name)}`)
		.join('');
	const siblings = element.parentElement
		? [...element.parentElement.children].filter((child) => child.tagName === element.tagName)
		: [];
	const position =
		siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(element) + 1})` : '';
	return `${tag}${classes}${position}`;
}

function attributeSelector(element: Element): string | null {
	const tag = element.tagName.toLowerCase();

	const id = element.getAttribute('id');
	if (id && isStableToken(id) && isUnique(`#${CSS.escape(id)}`, element)) {
		return `#${CSS.escape(id)}`;
	}

	for (const name of TEST_ATTRIBUTES) {
		const value = element.getAttribute(name);
		if (value && isUnique(`${tag}${attr(name, value)}`, element)) return `${tag}${attr(name, value)}`;
	}

	for (const name of ['name', 'aria-label']) {
		const value = element.getAttribute(name);
		if (value && isUnique(`${tag}${attr(name, value)}`, element)) return `${tag}${attr(name, value)}`;
	}

	const href = element.getAttribute('href');
	if (tag === 'a' && href && !href.startsWith('javascript:')) {
		const selector = `a${attr('href', href)}`;
		if (isUnique(selector, element)) return selector;
	}

	return null;
}

function pathSelector(element: Element): string {
	const parts: string[] = [];
	let current: Element | null = element;

	for (let depth = 0; current && depth < MAX_PATH_DEPTH; depth++) {
		if (current !== element) {
			const id = current.getAttribute('id');
			if (id && isStableToken(id)) {
				parts.unshift(`#${CSS.escape(id)}`);
				break;
			}
		}

		parts.unshift(segment(current));
		const selector = parts.join(' > ');
		if (isUnique(selector, element)) return selector;

		current = current.parentElement;
		if (current === document.body || current === document.documentElement) {
			parts.unshift(current.tagName.toLowerCase());
			break;
		}
	}

	return parts.join(' > ');
}

export function fingerprint(element: Element): ElementFingerprint {
	const attributes: Record<string, string> = {};
	for (const name of CAPTURED_ATTRIBUTES) {
		const value = element.getAttribute(name);
		if (value) attributes[name] = value.slice(0, 200);
		if (Object.keys(attributes).length === MAX_ATTRIBUTES) break;
	}

	return {
		selector: attributeSelector(element) ?? pathSelector(element),
		tag: element.tagName.toLowerCase(),
		text: isForm(element) ? undefined : visibleText(element),
		attributes
	};
}

export function findElement(element: ElementFingerprint): Element | null {
	try {
		return document.querySelector(element.selector);
	} catch {
		return null;
	}
}
