# Deckmate

Mannschaft gegen Offiziere: ein rundenbasiertes Brettspiel aus Dame, Schach, Würfeln und Karten, entstanden im LARP-Umfeld der Crimson Guard. Gespielt wird im Browser an einem 3D-Spieltisch, allein an einem Gerät oder online gegeneinander.

## Aufbau

| Bereich | Datei |
|---|---|
| Regel-Engine (reine Funktionen, ohne Grafik) | `src/game/rules.ts` |
| Spieleraktionen für lokal und online | `src/game/actions.ts` |
| Tests der Regeln | `src/game/rules.test.ts` |
| 3D-Spieltisch (Three.js) | `src/three/Table3D.ts` |
| Spielansicht mit Seitenleiste | `src/components/GameView.tsx` |
| Anmeldung, Lobby, Partien | `src/auth.tsx`, `src/online.ts`, `src/pages/` |
| Firestore-Sicherheitsregeln und Indizes | `firestore.rules`, `firestore.indexes.json` |

Der Spielstand einer Online-Partie liegt vollständig in `games/{id}.state`. Jede Aktion wird in einer Firestore-Transaktion angewendet, damit sich zwei Browser nie gegenseitig überschreiben.

## Lokal starten

```bash
npm install
npm run dev     # Entwicklungsserver
npm test        # Regel-Tests
npm run build   # Produktions-Build
```

## Einmalige Einrichtung in Firebase (Projekt deckmate-633e4)

1. **Authentication → Sign-in method:** Anbieter „E-Mail/Passwort“ aktivieren.
2. **Authentication → Settings → Autorisierte Domains:** die Vercel-Domain eintragen (z. B. `deckmate.vercel.app`), sonst schlägt die Anmeldung dort fehl.
3. **Firestore:** Datenbank anlegen (Standort Frankfurt, `europe-west3`), dann unter **Regeln** Inhalt von `firestore.rules` einfügen und veröffentlichen.
4. **Firestore → Indizes:** die beiden Indizes aus `firestore.indexes.json` anlegen. Alternativ öffnet die Lobby beim ersten Laden einen Fehler mit direktem Link in der Browser-Konsole.

## Benachrichtigungen aufs Handy (Web Push)

Wer online spielt, kann sich benachrichtigen lassen, sobald er dran ist, auch bei geschlossenem Spiel. Das läuft über normales Web Push. Jeder Browser, der die Benachrichtigung einschaltet, trägt sein Push-Abo in die Partien des Spielers ein (`games/{id}.push`). Nach jedem Zug ruft der Browser `POST /api/notify` auf; die Funktion liest die Partie über die Firestore-REST-API mit dem Anmelde-Token des Spielers (es gelten also die normalen Regeln), ermittelt, wer jetzt dran ist, und schickt jede Situation nur einmal (`games/{id}.pushSent`). Der Service Worker `public/sw.js` zeigt die Nachricht an.

Wo es geht: Chrome, Edge und Firefox auf Rechner und Android, Safari auf dem iPhone, sobald Deckmate über „Zum Home-Bildschirm“ hinzugefügt ist. Unter GrapheneOS ohne Google-Dienste braucht es einen Browser mit UnifiedPush, etwa IronFox oder Fennec, dazu die App ntfy aus F-Droid als Verteiler. Vanadium, Brave und das offizielle Firefox hängen für Push an Googles FCM.

**Einrichtung:** Kein Firebase-Dienstkonto, keine neuen Firestore-Regeln. Nur einmal in Vercel (Settings → Environment Variables) **`VAPID_PRIVATE_KEY`** für Production und Preview setzen und neu deployen. Den Wert schlägt die App selbst vor: `/api/notify` öffnen, solange die Variable fehlt, und `suggestedKey` kopieren (bei jedem Aufruf ein neuer). Alternativ erzeugt ihn `npx web-push generate-vapid-keys` („Private Key“). Den öffentlichen Schlüssel berechnet die Funktion selbst. Den Wert danach nicht mehr ändern, sonst muss jeder die Benachrichtigung neu einschalten. Ohne die Variable ist der Schalter unsichtbar und alles andere läuft wie bisher.

Optional: `VAPID_SUBJECT` (Kontakt für Push-Dienste, z. B. `mailto:du@example.org`), `APP_URL` (öffentliche Adresse für die Links in den Nachrichten). `GET /api/notify` zeigt, ob Push bereit ist.

## Bekannte Grenzen

- Würfel und Kartenverteilung laufen im Browser. Für Schutz gegen Schummeln müssen sie in Cloud Functions wandern (Blaze-Tarif).
- Handkarten liegen offen auf dem Tisch.
- Eine Seite ohne legale Züge verliert noch nicht automatisch.
