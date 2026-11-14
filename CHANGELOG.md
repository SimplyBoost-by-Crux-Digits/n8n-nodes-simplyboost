# Changelog

## 0.1.2 (2026-11-14)

- SimplyBoost Trigger: the setup notice above the Event field is gone (n8n's review asks that setup and
  token requirements are not shown as a banner on the node form). What it said is now in the README
  ("Before you use the trigger") and in the API Token field's description. No change in behaviour.

## 0.1.1 (2026-11-08)

- Published from GitHub Actions with npm provenance (trusted publishing). No code changes.

## 0.1.0 (2026-11-08)

- SimplyBoost node: Message → Send; Knowledge → Add or Update Text, Refresh Website, Get, Get Many;
  Missing Answer → Get Many; Conversation → Get, Get Many, Reply, Resolve, Reopen; Lead → Get, Get Many, Update. Usable as an
  AI Agent tool.
- SimplyBoost Trigger: Conversation Handed to Team, Conversation Resolved, Lead Captured, Question Not
  Answered, Knowledge Source Processed. Registers and removes its webhook in SimplyBoost and checks
  every event's signature.
