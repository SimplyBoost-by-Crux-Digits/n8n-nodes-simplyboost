# n8n-nodes-simplyboost

This is an n8n community node package. It lets you use [SimplyBoost](https://simplyboost.io) in your n8n workflows.

SimplyBoost is an AI support and knowledge platform for companies with document-heavy support: manufacturers, importers with dealer networks, technical wholesalers and logistics companies. Its AI agent answers customers, dealers and colleagues from your manuals, price lists and policies, and hands conversations to your team when a person is needed.

With these nodes you can:

- **Ask the AI agent** from any workflow: answer an incoming email or ticket, or give an n8n AI Agent your product knowledge as a tool.
- **Keep its knowledge in step** with your ERP, PIM or CMS: add or update text sources, refresh a website after you publish.
- **Act when something happens**: a conversation is handed to your team, a lead is captured, a question could not be answered, a knowledge source finished processing.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation) · [Operations](#operations) · [Credentials](#credentials) · [Compatibility](#compatibility) · [Usage](#usage) · [Resources](#resources) · [Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. The package name is `n8n-nodes-simplyboost`.

## Operations

### SimplyBoost (actions)

| Resource | Operation | What it does |
|---|---|---|
| Message | Send | Ask the AI agent a question and get its answer, sources and a thread ID. Pass the thread ID to continue the conversation. |
| Knowledge | Add or Update Text | Updates the chatbot's text source with this title (ignoring case), or adds it. Unchanged text is not processed again. Built for nightly syncs from an ERP or PIM. |
| Knowledge | Refresh Website | Reads a website source again now, for example after you publish a page. |
| Knowledge | Get / Get Many | One knowledge source (optionally with the text read from it), or the list. |
| Conversation | Get / Get Many | A conversation with its messages, or the most recent conversations. |
| Conversation | Reply | Replies as a person (the token's owner) in a conversation that is with your team. The reply goes to the customer on the conversation's channel. |
| Conversation | Resolve / Reopen | Marks a conversation resolved, for example when your helpdesk closes the ticket. |
| Lead | Get / Get Many / Update | Read leads, or change name, email, phone and company, or mark one converted. |

The SimplyBoost node can be used as a tool by n8n's AI Agent.

### SimplyBoost Trigger

Starts a workflow on these events. Choose one or more, for all chatbots or one:

| Event | When |
|---|---|
| Conversation Handed to Team | The AI agent handed a conversation to a person and a ticket opened. |
| Conversation Resolved | A conversation was marked resolved. |
| Lead Captured | A visitor left an email address or phone number. |
| Question Not Answered | A visitor asked a question the AI agent could not answer (a new entry in Missing answers). |
| Knowledge Source Processed | A knowledge source finished processing, or failed. |

The trigger registers its webhook in SimplyBoost when you activate the workflow and removes it when you deactivate it. Every event is signed; the node checks the signature (HMAC-SHA256) and refuses anything else. Test chats your team runs in the dashboard are left out unless you switch on **Include Test Chats** (they are always passed on while n8n listens for a test event).

## Credentials

1. You need a SimplyBoost account on the **Growth, Pro or Enterprise** plan; the API is part of those plans.
2. In the SimplyBoost dashboard, go to **Settings → API** and create a token. Only the team owner can create tokens.
3. Give the token the scopes for what you will use:
   - Message: `conversations:write`
   - Knowledge: `knowledge:read`, `knowledge:write`
   - Conversation: `conversations:read`, `conversations:write`
   - Lead: `leads:read`, `leads:write`
   - Trigger: `webhooks:read`, `webhooks:write`
   - Choosing a chatbot from the list: `chatbots:read`
4. In n8n, create a **SimplyBoost API** credential and paste the token. Leave **API URL** as it is unless SimplyBoost gave you another address.

The trigger needs a token that covers every chatbot (not one limited to some), because webhooks carry events for the whole account.

## Compatibility

Built with `@n8n/node-cli` and tested with n8n 2.x. Works on n8n Cloud and self-hosted n8n.

The trigger needs n8n to be reachable at a public `https://` address: SimplyBoost does not send events to `http://`, `localhost` or private addresses. On self-hosted n8n, set `WEBHOOK_URL` to the public address.

## Usage

- **Limits.** The API allows 120 requests a minute per token. The node waits and retries when SimplyBoost says it is busy (HTTP 429). An account can have at most 10 webhooks; each active SimplyBoost Trigger uses one, and so does a trigger while n8n listens for a test event.
- **Retries without duplicates.** Message → Send and Conversation → Reply take an **Idempotency Key** option. Use the ID of the email, ticket or comment you are answering: if the step runs again with the same key, SimplyBoost returns the first result instead of asking or sending twice.
- **Messages count toward your plan.** Each Message → Send is one message of your monthly allowance, like a chat on your website.
- **Add or Update Text** matches on the title. Keep one title per document (for example `Price list 2026 - spare parts`). If two text sources share a title the step stops and says so.
- **Example workflows** are in [`examples/`](examples/): a nightly ERP sync into the knowledge, a handover alert by email, missing answers to a product expert, and new leads to a CRM.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [SimplyBoost API documentation](https://simplyboost.io/docs/api)
- Support: hello@simplyboost.io

## Version history

See [CHANGELOG.md](CHANGELOG.md).
