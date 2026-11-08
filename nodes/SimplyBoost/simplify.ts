import type { IDataObject } from 'n8n-workflow';

/** The answer of a sent message, without the parts most workflows do not use. */
export function simplifySend(data: IDataObject): IDataObject {
	const conversation = (data.conversation ?? {}) as IDataObject;
	const message = (data.message ?? {}) as IDataObject;
	const answer = (message.answer ?? null) as IDataObject | null;
	return {
		threadId: conversation.threadId ?? null,
		chatbotId: conversation.chatbotId ?? null,
		answer: answer?.text ?? null,
		sources: message.sources ?? [],
		suggestedQuestions: message.suggestedQuestions ?? [],
		mode: conversation.mode ?? null,
		escalated: conversation.escalated ?? false,
		ticketCode: conversation.ticketCode ?? null,
	};
}

/** A conversation with the fields a workflow acts on; messages only as role, text and time. */
export function simplifyConversation(conversation: IDataObject): IDataObject {
	const simplified: IDataObject = {
		threadId: conversation.threadId ?? null,
		chatbotId: conversation.chatbotId ?? null,
		channel: conversation.channel ?? null,
		mode: conversation.mode ?? null,
		escalated: conversation.escalated ?? false,
		resolved: conversation.resolved ?? false,
		ticketCode: conversation.ticketCode ?? null,
		lastMessageAt: conversation.lastMessageAt ?? null,
	};
	if (Array.isArray(conversation.messages)) {
		simplified.messages = (conversation.messages as IDataObject[]).map((message) => ({
			role: message.role,
			text: message.text,
			createdAt: message.createdAt,
		}));
	}
	return simplified;
}
