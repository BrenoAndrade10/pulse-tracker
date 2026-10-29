/** Eventos padrão da Meta, para a Conversions API reconhecer sem mapeamento. */
export const STANDARD_EVENTS: { name: string; label: string; hint: string }[] = [
	{ name: 'Lead', label: 'Lead', hint: 'Demonstrou interesse e deixou contato' },
	{ name: 'CompleteRegistration', label: 'Cadastro completo', hint: 'Terminou um cadastro' },
	{ name: 'Contact', label: 'Contato', hint: 'Chamou no WhatsApp, e-mail ou telefone' },
	{ name: 'Schedule', label: 'Agendamento', hint: 'Marcou uma reunião ou consulta' },
	{ name: 'SubmitApplication', label: 'Inscrição', hint: 'Enviou uma candidatura ou inscrição' },
	{ name: 'ViewContent', label: 'Visualização de conteúdo', hint: 'Abriu um conteúdo importante' },
	{ name: 'AddToCart', label: 'Adicionar ao carrinho', hint: 'Colocou um produto no carrinho' },
	{ name: 'InitiateCheckout', label: 'Início de checkout', hint: 'Clicou para pagar' },
	{ name: 'Purchase', label: 'Compra', hint: 'Concluiu uma compra' },
	{ name: 'Subscribe', label: 'Assinatura', hint: 'Assinou um plano' }
];

export const CUSTOM_EVENT = '__custom__';
export const CUSTOM_EVENT_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export function eventLabel(name: string): string {
	return STANDARD_EVENTS.find((event) => event.name === name)?.label ?? name;
}
