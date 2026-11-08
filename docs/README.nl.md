# SimplyBoost voor n8n (Nederlands)

De volledige handleiding staat in het Engels in [README.md](../README.md); n8n vraagt Engelstalige documentatie bij community nodes. Hieronder de korte versie.

**Wat het doet.** Met dit pakket koppel je SimplyBoost aan je eigen systemen in n8n:

- **Vraag de AI-assistent** vanuit elke workflow, bijvoorbeeld om een binnenkomende e-mail of ticket te beantwoorden.
- **Houd de kennis actueel** vanuit je ERP, PIM of CMS: tekstbronnen toevoegen of bijwerken (op titel), of een website opnieuw laten inlezen na publicatie.
- **Reageer op gebeurtenissen**: een gesprek is aan je team overgedragen, een lead is binnen, een vraag kon niet worden beantwoord, of een kennisbron is verwerkt.

**Wat je nodig hebt.**

1. Een SimplyBoost-account met het **Growth-, Pro- of Enterprise**-abonnement (daar zit de API in).
2. Een API-token: in het dashboard onder **Instellingen → API** (alleen de eigenaar van het team kan tokens maken). Geef het token de scopes die je gebruikt; zie de tabel in README.md.
3. In n8n: installeer de community node `n8n-nodes-simplyboost` en maak een **SimplyBoost API**-credential met het token.

**Goed om te weten.**

- De trigger werkt alleen als n8n bereikbaar is op een openbaar `https://`-adres.
- Elke vraag via **Message → Send** telt als één bericht van je maandelijkse bundel.
- Gebruik bij Send en Reply een **Idempotency Key** (bijvoorbeeld het ticketnummer), zodat een herhaalde stap niets dubbel stuurt.
- Testgesprekken uit het dashboard starten de workflow niet, tenzij je **Include Test Chats** aanzet.

Vragen? Mail naar hello@simplyboost.io.
