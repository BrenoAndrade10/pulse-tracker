import type { ElementFingerprint } from '../fingerprint';

export type RuleScope = 'page' | 'site';
export type RuleTrigger = 'click' | 'submit';

export type RuleField = {
	key: 'name' | 'email' | 'phone' | 'consent' | 'custom';
	slug: string;
	label: string;
	selector: string;
};

export type TrackingRule = {
	id: string;
	scope: RuleScope;
	trigger: RuleTrigger;
	eventName: string;
	element: ElementFingerprint;
	fields: RuleField[];
};

export type SetupSession = {
	publicKey: string;
	pageUrl: string;
	rules: TrackingRule[];
};

export class SetupApiError extends Error {
	constructor(
		readonly status: number,
		readonly reason: string,
		readonly messages: string[] = []
	) {
		super(reason);
	}
}

export class SetupApi {
	constructor(
		private readonly baseUrl: string,
		private readonly token: string
	) {}

	openSession(): Promise<SetupSession> {
		return this.request<SetupSession>('POST', '/t/setup/session');
	}

	createRule(input: Omit<TrackingRule, 'id'>): Promise<TrackingRule> {
		return this.request<TrackingRule>('POST', '/t/setup/rules', input);
	}

	async deleteRule(id: string): Promise<void> {
		await this.request<void>('DELETE', `/t/setup/rules/${encodeURIComponent(id)}`);
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		let response: Response;
		try {
			response = await fetch(`${this.baseUrl}${path}`, {
				method,
				mode: 'cors',
				credentials: 'omit',
				headers: {
					'X-Pulse-Setup-Token': this.token,
					...(body === undefined ? {} : { 'Content-Type': 'application/json' })
				},
				body: body === undefined ? undefined : JSON.stringify(body)
			});
		} catch {
			throw new SetupApiError(0, 'NETWORK_ERROR');
		}

		if (response.status === 204) return undefined as T;

		const payload = (await response.json().catch(() => null)) as {
			reason?: string;
			data?: { errors?: unknown };
		} | null;

		if (!response.ok) {
			const errors = payload?.data?.errors;
			throw new SetupApiError(
				response.status,
				payload?.reason ?? 'UNEXPECTED_ERROR',
				Array.isArray(errors) ? errors.filter((e): e is string => typeof e === 'string') : []
			);
		}

		return payload as T;
	}
}
