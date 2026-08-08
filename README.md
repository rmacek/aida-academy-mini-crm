# AIDA CRM

AIDA CRM ist eine installierbare, mehrbenutzerfähige Marketplace-Anwendung für
Verkaufschancen. Eine Installation bildet den gemeinsamen CRM-Arbeitsbereich
eines Unternehmens. Sie besitzt eine eigene PostgreSQL-Datenbank und ist von
anderen Installationen vollständig getrennt.

## Produktumfang

- persönliches Pipeline-Dashboard mit allen laufenden Verkaufschancen, gewichteter Pipeline, nächstem Schritt sowie offenen und überfälligen Aufgaben
- Verkaufschancen mit Kunden-UseCase, Phase, Wert und Abschlusswahrscheinlichkeit
- Termine, Aufgaben, Notizen und freigegebene Dokumente
- mehrere Unterhaltungen und gespeicherte KI-Artefakte je Verkaufschance
- CRM-Rollen `admin`, `sales` und `reader` mit erzwungenem Passwortwechsel
- vorkonfigurierte, tenantlokal verwaltbare CRM-Assistenten
- Machbarkeitsanalyse, Meeting-Briefing, E-Mail, Angebot, Umsetzungs-Handout und
  belegte AIDA-Feature-Spezifikation
- serverseitig erzwungene Kontextisolation und Auditprotokoll

## Klare Produktgrenze

Die CRM-Fachlogik ist **kein Bestandteil von AIDA**. Das CRM-Paket speichert die
englischen ACTION-Prompts, Startaufgaben, Modellprofile und Aktivierungszustände
seiner Assistenten in der eigenen Datenbank. Zur Laufzeit übergibt es nur den
bereinigten Snapshot der aktiven Verkaufschance an die generische, tenantgebundene
AIDA-API. AIDA stellt Chat, Modellprofile, Knowledge und Service-Accounts bereit.

ACTION bedeutet in diesem Projekt exakt:

1. **Act**
2. **Context**
3. **Task**
4. **Instructions**
5. **Output**
6. **Narrowing**

## Daten und Sicherheit

- Strukturierte Daten, Benutzer, Sessions, Assistenten und Auditereignisse liegen
  in der installationseigenen PostgreSQL-Datenbank.
- Dokumente liegen im installationseigenen Olares-AppData-Verzeichnis; Metadaten
  und SHA-256-Prüfsummen liegen in PostgreSQL.
- AIDA-Service-Token und Datenbankkennwort bleiben ausschließlich serverseitig.
- Dokumentinhalte gelten im Prompt als nicht vertrauenswürdige Geschäftsdaten.
- Das CRM sendet keine internen Datenbank- oder Benutzer-IDs an das Modell.
- Lokale Modellverarbeitung wird bevorzugt. Cloud-Verarbeitung bleibt durch das
  gewählte AIDA-Modellprofil und dessen Freigaben begrenzt.

## Lokal prüfen

Erforderlich sind Node.js `>=22.13.0` und PostgreSQL 16 oder neuer. Die Werte aus
`.dev.vars.example` werden als lokale Umgebungsvariablen gesetzt; echte Token und
Passwörter dürfen nicht committed werden.

```bash
npm ci
npm run test:all
npm run dev
```

Das Datenbankschema wird beim ersten Readiness-Aufruf unter einem PostgreSQL-
Advisory-Lock versioniert migriert. `CRM_SEED_SAMPLE_DATA=true` erzeugt zwei rein
synthetische Verkaufschancen für den Isolationstest.

## Wesentliche Laufzeitvariablen

| Name | Zweck |
| --- | --- |
| `DATABASE_URL` oder `CRM_POSTGRES_*` | Eigene PostgreSQL-Datenbank der Installation |
| `CRM_TENANT_NAME` | Sichtbarer Name des gemeinsamen CRM-Arbeitsbereichs |
| `CRM_BOOTSTRAP_ADMIN_USERNAME` | Erster CRM-Administrator bei leerer Datenbank |
| `CRM_BOOTSTRAP_ADMIN_PASSWORD` | Initialpasswort; Wechsel bei erster Anmeldung |
| `AIDA_API_BASE_URL` | Öffentliche HTTPS-Adresse der AIDA-Instanz |
| `AIDA_SERVICE_TOKEN` | Tenantgebundener Service-Account-Token |
| `AIDA_MODEL_PROFILE_NAME` | Kostenoptimiertes Standard-Modellprofil |
| `AIDA_PRODUCT_KNOWLEDGE_BASE_ID` | Freigegebene AIDA-Produktwissensbasis |

## Olares

Das Chart liegt unter `deploy/olares/aidacrm`. Es unterstützt mehrere unabhängige
Installationen, bezieht PostgreSQL über Olares-Middleware und läuft ohne Root,
privilegierte Linux-Capabilities oder beschreibbares Root-Dateisystem. Das CRM
akzeptiert AIDA-Ziele ausschließlich per HTTPS. `spec.apiTimeout: 0` im
Olares-Manifest erlaubt lange lokale Modellläufe ohne das standardmäßige
15-Sekunden-Zeitlimit. Die versionierte NDJSON-API von AIDA und der
Antwortstrom des CRM senden zusätzlich regelmäßig Heartbeats.

## Kontrollierte Veröffentlichung

Der vorhandene Workflow `.github/workflows/deliver.yml` übernimmt nach einem
freigegebenen Review die reproduzierbare Delivery. Er prüft die Anwendung und
das Olares-Chart, lehnt bereits vorhandene Image-Tags ab, erzeugt ein
SBOM-attestiertes Multi-Arch-Image für `linux/amd64` und `linux/arm64` und legt
Chart, Prüfsumme, Image-Digest und Manifest als GitHub-Actions-Artefakt ab.

Der Workflow wird ausschließlich auf einem persönlichen Workshop-Branch und
mit einer neuen, in `package.json`, `Chart.yaml` und `OlaresManifest.yaml`
identischen Version gestartet. Die Marketplace-Installation bleibt eine
getrennte, ausdrücklich bestätigte Trainerhandlung.
