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

## Bekannte Grenzen

- Würfel und Kartenverteilung laufen im Browser. Für Schutz gegen Schummeln müssen sie in Cloud Functions wandern (Blaze-Tarif).
- Handkarten liegen offen auf dem Tisch.
- Eine Seite ohne legale Züge verliert noch nicht automatisch.
