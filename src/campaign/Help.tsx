import { useEffect, useMemo, useRef, useState } from 'react';
import { LAND, type Land } from './map.ts';
import { AGENT_BONUS, AGENT_RANGE, AUTO_WIN, BUILDINGS, BUILDING_KEYS, COST, MAX_AGENTS, MAX_ARMY, ORDERS_PER_ROUND, SPEC_NAME, TRADER_SPEED, UMLAND, type BuildingKey, type SpecKey } from './engine.ts';

type Entry = { t: string; d: string; tags?: string };
type Chapter = { n: string; icon: string; items: Entry[] };

const pct = (x: number) => `${Math.round((x - 1) * 100)} %`;

function chapters(): Chapter[] {
  const specLine = (k: SpecKey) => Object.entries(AGENT_BONUS[k]).map(([b, x]) => `auf ${BUILDINGS[b as BuildingKey].n}: ${x!.text}`).join('; ');
  return [
    {
      n: 'Befehle', icon: '✒', items: [
        { t: 'Befehl', d: `Jedes Haus gibt pro Runde bis zu ${ORDERS_PER_ROUND} Befehle. Sie werden geheim abgegeben, das Gerät geht dafür reihum. Danach werden alle Befehle beider Häuser gleichzeitig ausgeführt.` },
        { t: 'Ziehen', d: 'Fahne antippen, dann leuchtende Felder anklicken: Der Weg folgt den Hexfeldern. Weitere Klicks hängen Wegpunkte an, das letzte Feld noch einmal antippen (oder „Weg bestätigen“) gibt den Befehl. Jedes betretene Feld wird eigen. Auf einem feindlichen Heer endet der Weg mit einem Angriff.', tags: 'bewegen angreifen marsch weg wegpunkt' },
        { t: 'Bewegungspunkte', d: 'Die Reichweite hängt von der Größe ab: bis 6 Figuren 5 Punkte, 7 bis 11 Figuren 4, ab 12 Figuren 3. Ohne Spezialisten fehlt die Disziplin: 1 Punkt weniger. Ein Feld kostet 1 Punkt, Gebirge und Sumpf kosten 2.', tags: 'reichweite tempo disziplin' },
        { t: 'Unterstützen', d: 'Das Heer bleibt stehen und hilft auf einem Nachbarfeld, bei Angriff wie Verteidigung. Es zählt mit seiner halben Größe und bringt in einer Brett-Schlacht eine Extrakarte.', tags: 'hilfe support' },
        { t: 'Fouragieren', d: `Das Heer bleibt stehen und versorgt sich aus dem Land: +1 Figur, auf Ackerland +2, im Gebirge nichts. Ein Heer hat höchstens ${MAX_ARMY} Figuren.`, tags: 'fourage nahrung versorgung auffüllen' },
        { t: 'Rekrutieren', d: `Stadtbefehl für ${COST.recruit} Gold: 3 neue Figuren auf dem Stadtfeld, mit Kaserne im Umland 4 (Einzelgänger können weitere bringen). Sie stoßen nach dem Marsch dazu.`, tags: 'stadt truppen' },
        { t: 'Ausbilden', d: `Stadtbefehl für ${COST.train} Gold: ein Spezialist – ins Heer auf dem Stadtfeld oder als Einzelgänger. Dafür braucht die Stadt das passende aktive Gebäude im Umland.`, tags: 'stadt spezialist einzelgänger' },
        { t: 'Bauen', d: `Über die Bauleiste unten: Reiter wählen, Gebäude antippen, dann ein leuchtendes Feld. Oder erst ein Feld antippen – dann zeigt die Leiste nur, was dort geht. Gebäude stehen auf eigenen Feldern im Umland einer eigenen Stadt (bis ${UMLAND} Felder entfernt), die Stadtmauer auf dem Stadtfeld. Zählt als Befehl.`, tags: 'gebäude umland bauleiste' },
        { t: 'Forschung', d: 'Je Bereich (Wirtschaft, Militär, Glaube, Verteidigung) zwei Stufen, 4 und 7 Gold. Forschung kostet keinen Befehl, aber nur eine pro Runde. Sie wirkt ab der nächsten Runde und erlaubt die nächste Stufe der Gebäude dieses Bereichs.', tags: 'forschen technik zunftwesen drill liturgie festungsbau' },
        { t: 'Ausbau', d: 'Gebäude wachsen bis Stufe III, wenn die Forschung des Bereichs so weit ist. Ausbau kostet einen Befehl und Gold (Grundpreis +2 je Stufe). Kaserne: Rekruten +1 je Stufe. Ausbildungsgebäude: Spezialist im Umkreis 1 Gold billiger je Stufe über I. Markt: +1 Gold je Stufe, Händler bringen mehr. Mauer: Verteidiger +30/50/70 %.', tags: 'stufe level upgrade' },
        { t: 'Versiegeln', d: 'Schließt deine Befehle für diese Runde ab. Danach ist das andere Haus dran, ohne deine Befehle zu sehen.' },
      ],
    },
    {
      n: 'Kampf', icon: '⚔', items: [
        { t: 'Gleichzeitig ziehen', d: 'Beim Aufdecken gehen alle Heere Schritt für Schritt gleichzeitig. Zum Konflikt kommt es, wenn zwei Heere im selben Schritt dasselbe Feld betreten, wenn sie aneinander vorbei die Felder tauschen wollen oder wenn eines auf ein stehendes feindliches Heer trifft. Danach bleiben beide stehen.', tags: 'kreuzen begegnung schritt' },
        { t: 'Stärke', d: 'Größe des Heeres plus die halbe Größe der Unterstützer. Verteidiger auf ihrem Feld erhalten den Geländebonus und auf einem Stadtfeld mit Mauer weitere 30 %.' },
        { t: 'Übermacht', d: `Ist eine Seite mindestens ${AUTO_WIN}-mal so stark wie die andere, siegt sie ohne Schlacht. Sonst kommt es zur Schlacht.`, tags: 'auto-sieg automatisch' },
        { t: 'Wettlauf und Feldschlacht', d: 'Betreten beide dasselbe Feld im selben Schritt, besetzt es eine klare Übermacht, die andere Seite bleibt stehen. Ist es knapper, treffen sich die Heere im Feld: Das stärkere führt die Offiziere (bei Gleichstand der Würfel), der Sieger behält das Feld, der Verlierer kehrt um.', tags: 'wettlauf feldschlacht' },
        { t: 'Begegnung', d: 'Wollen zwei Heere aneinander vorbei die Felder tauschen, begegnen sie sich unterwegs: Eine klare Übermacht drängt die andere Seite zurück, sonst kommt es zur Feldschlacht.', tags: 'platztausch abprallen' },
        { t: 'Schlacht auf dem Brett', d: 'Knappe Kämpfe werden als Deckmate-Partie ausgetragen. Der Angreifer führt die Offiziere, der Verteidiger die Mannschaft (höchstens 12 Steine). Die Überlebenden kehren auf die Karte zurück.', tags: 'deckmate partie offiziere mannschaft' },
        { t: 'Auswürfeln', d: 'Schneller Ersatz für die Brett-Schlacht. Die Siegchance entspricht dem Stärkeverhältnis. Der Sieger verliert rund 30 % seiner Figuren, der Verlierer rund die Hälfte.', tags: 'würfel schnell' },
        { t: 'Rückzug', d: 'Wer überrannt wird, weicht auf ein angrenzendes Feld ohne feindliches Heer aus, am liebsten ein eigenes. Gibt es keines, löst sich das Heer auf.', tags: 'flucht' },
      ],
    },
    {
      n: 'Heere', icon: '⚑', items: [
        { t: 'Heer', d: `Die Zahl auf der Fahne ist die Größe (höchstens ${MAX_ARMY}), der goldene Punkt die Zahl der Spezialisten. Enden zwei eigene Heere auf demselben Feld, vereinen sie sich; durchziehen geht ohne.`, tags: 'armee größe fahne' },
        { t: 'Einzelgänger', d: `Ein Spezialist ohne Heer (höchstens ${MAX_AGENTS} je Haus). Er zieht bis ${AGENT_RANGE} Punkte weit, meidet feindliche Heere und wird gefangen, wenn eines sein Feld betritt. Auf einem passenden eigenen, aktiven Gebäude gibt er einen Bonus; endet sein Weg bei einem eigenen Heer, tritt er ihm bei.`, tags: 'agent spezialist bonus' },
        { t: SPEC_NAME.CAP, d: `Höchstens 1 pro Heer, braucht eine ${BUILDINGS.messe.n}. Als Einzelgänger ${specLine('CAP')}.`, tags: 'spezialist offizier' },
        { t: SPEC_NAME.KAP, d: `Höchstens 2 pro Heer, braucht eine ${BUILDINGS.kapelle.n}. Als Einzelgänger ${specLine('KAP')}.`, tags: 'spezialist kaplan kollekte' },
        { t: SPEC_NAME.KAN, d: `Höchstens 2 pro Heer, braucht eine ${BUILDINGS.giesserei.n}. Als Einzelgänger ${specLine('KAN')}.`, tags: 'spezialist kanone' },
        { t: SPEC_NAME.MAR, d: `Höchstens 2 pro Heer, braucht eine ${BUILDINGS.kaserne.n}. Als Einzelgänger ${specLine('MAR')}.`, tags: 'spezialist marines geleitschutz' },
        { t: 'First Leutnant', d: 'Führt jedes angreifende Heer in der Brett-Schlacht an. Fällt er, ist die Schlacht verloren.' },
        { t: 'Fieber', d: 'Ein Heer, das am Rundenende im Sumpf steht, verliert 1 Figur.', tags: 'sumpf krankheit' },
      ],
    },
    {
      n: 'Land und Gold', icon: '⛁', items: [
        { t: 'Feld', d: 'Jedes Hexfeld gehört dem Haus, dessen Heer es zuletzt betreten hat – auch wenn das Heer weiterzieht. Die farbige Kontur zeigt die Reichsgrenze.', tags: 'besitz grenze hexfeld' },
        { t: 'Provinz', d: 'Ein Gebiet aus mehreren Feldern. Sie gehört dem Haus mit den meisten Feldern darin; eine Provinz mit Stadt gehört, wer das Stadtfeld hält.', tags: 'besitz' },
        { t: 'Stadt', d: 'Eingenommen wird eine Stadt nur, wenn ein Heer ihr Stadtfeld betritt. Städte bringen Gold und Punkte, rekrutieren und bilden aus.' },
        { t: 'Umland', d: `Alle Felder bis ${UMLAND} Schritte um eine Stadt. Dort stehen ihre Gebäude.`, tags: 'gebäude' },
        { t: 'Hauptstadt', d: 'Stadt mit Krone. Wer das gegnerische Hauptstadtfeld hält, gewinnt die Kampagne.', tags: 'sieg krone' },
        { t: 'Händler', d: `Jeder aktive Markt schickt einen Händler zur nächsten eigenen Stadt. Er zieht ${TRADER_SPEED} Felder pro Runde und bringt bei Ankunft Gold (je weiter, desto mehr). Ein feindliches Heer auf seinem Weg überfällt ihn und erbeutet die Hälfte.`, tags: 'markt gold handel' },
        { t: 'Einkommen', d: 'Am Rundenende: 1 Gold je Provinz, +2 je Stadt, +1 je aktivem Markt, dazu die Kollekte von Kaplänen auf Märkten. Händler bringen extra.', tags: 'gold' },
        { t: 'Gold', d: 'In der Kopfleiste steht „verfügbar/gesamt“: was nach deinen geplanten Befehlen übrig bleibt. Das Gold des Gegners bleibt verdeckt.', tags: 'geld' },
        { t: 'Punkte', d: 'Provinz 1 Punkt, Stadt 3 Punkte, ein erfülltes geheimes Ziel 4 Punkte. Nach der letzten Runde gewinnt, wer mehr Punkte hat. Die Rundenzahl wird beim Start gewählt.', tags: 'sieg wertung runden' },
        { t: 'Geheimes Ziel', d: 'Wird beim Start gezogen, wenn eingeschaltet. Nur das eigene Haus sieht es links in der Übersicht, mit Fortschritt. Erst nach der letzten Runde wird aufgedeckt; erfüllt bringt es 4 Punkte.', tags: 'ziel mission auftrag' },
        { t: 'Erfahrung', d: 'Wenn eingeschaltet: Ein Heer bekommt 1 Erfahrung für einen klar gewonnenen Konflikt, nach einer Schlacht 1 für jede überlebende Seite und 1 mehr für den Sieger. Ab 2 ist es Erprobt (+10 % Stärke, ein Winkel), ab 4 Veteran (+20 %, zwei Winkel, eine Extrakarte auf dem Brett). Vereinigen und Rekruten verwässern die Erfahrung nach Köpfen.', tags: 'veteran erprobt rang xp winkel' },
      ],
    },
    {
      n: 'Gelände', icon: '⛰', items: (Object.keys(LAND) as Land[]).map((k) => {
        const l = LAND[k];
        const parts = [
          k === 'G' || k === 'S' ? 'Kostet 2 Bewegungspunkte.' : 'Kostet 1 Bewegungspunkt.',
          l.forage === 0 ? 'Keine Fourage.' : `Fourage +${l.forage}.`,
          l.defense > 1 ? `Verteidiger ${pct(l.defense)} stärker.` : '',
          l.battle === 'fluss' ? 'In der Schlacht gilt die Furt.' : l.battle === 'gebirge' ? 'In der Schlacht erhält der Verteidiger eine Karte mehr.' : l.battle === 'huegel' ? 'In der Schlacht beginnt der Verteidiger.' : '',
          k === 'S' ? 'Fieber: −1 Figur pro Runde.' : '',
        ].filter(Boolean);
        return { t: l.n, d: parts.join(' '), tags: 'gelände land' };
      }),
    },
    {
      n: 'Gebäude', icon: '⌂', items: BUILDING_KEYS.map((b) => ({ t: BUILDINGS[b].n, d: `${BUILDINGS[b].cost} Gold. ${BUILDINGS[b].effect} Steht ein feindliches Heer auf dem Feld, ruht das Gebäude; zieht es weiter und das Feld bleibt in seiner Hand, ist das Gebäude erobert.`, tags: 'gebäude bauen umland' })),
    },
  ];
}

export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label="Hilfe: Begriffe erklärt" title="Begriffe erklärt" onClick={() => setOpen(true)} style={{
        width: 30, height: 30, borderRadius: '50%', padding: 0, display: 'grid', placeItems: 'center',
        background: 'var(--brass)', color: '#1E1A15', border: '1px solid #F1E3BE', fontFamily: 'var(--display)', fontWeight: 700, fontSize: 17,
        boxShadow: '0 0 0 3px color-mix(in srgb, var(--brass) 25%, transparent)',
      }}>?</button>
      {open && <HelpBook onClose={() => setOpen(false)} />}
    </>
  );
}

function HelpBook({ onClose }: { onClose: () => void }) {
  const all = useMemo(chapters, []);
  const [q, setQ] = useState('');
  const [ch, setCh] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const shown: { chapter: string; e: Entry }[] = needle
    ? all.flatMap((c) => c.items.filter((e) => `${e.t} ${e.d} ${e.tags ?? ''}`.toLowerCase().includes(needle)).map((e) => ({ chapter: c.n, e })))
    : all[ch].items.map((e) => ({ chapter: all[ch].n, e }));

  return (
    <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(8,12,18,.6)' }}>
      <div role="dialog" aria-label="Büchlein der Begriffe" onClick={(e) => e.stopPropagation()} style={{
        width: 'min(760px, 100%)', maxHeight: 'min(640px, 100%)', display: 'grid', gridTemplateColumns: '190px 1fr', overflow: 'hidden',
        background: '#EFE5CC', color: '#2A2118', borderRadius: 6, border: '1px solid #B89A5A',
        boxShadow: '0 24px 60px rgba(0,0,0,.55), inset 0 0 60px rgba(120,90,40,.18)',
      }}>
        <nav style={{ background: '#5A2E22', color: '#F1E3BE', padding: '18px 0', display: 'flex', flexDirection: 'column', gap: 2, borderRight: '3px solid #B89A5A' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: 18, padding: '0 16px 12px', borderBottom: '1px solid rgba(241,227,190,.25)', marginBottom: 8 }}>Kleines Feldbuch</div>
          {all.map((c, i) => (
            <button key={c.n} type="button" onClick={() => { setCh(i); setQ(''); }} style={{
              all: 'unset', cursor: 'pointer', padding: '7px 16px', display: 'flex', gap: 10, alignItems: 'center',
              background: !needle && i === ch ? 'rgba(241,227,190,.16)' : 'transparent', borderLeft: `3px solid ${!needle && i === ch ? '#E2C27F' : 'transparent'}`,
            }}>
              <span aria-hidden style={{ width: 16, textAlign: 'center', color: '#E2C27F' }}>{c.icon}</span>{c.n}
            </button>
          ))}
        </nav>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #CDB88A' }}>
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Begriff suchen, z. B. Fouragieren" aria-label="Begriff suchen" style={{
              flex: 1, background: '#F8F1DF', color: '#2A2118', border: '1px solid #CDB88A', borderRadius: 4, padding: '7px 10px', font: 'inherit',
            }} />
            <button type="button" aria-label="Büchlein schließen" onClick={onClose} style={{ all: 'unset', cursor: 'pointer', fontSize: 22, padding: '0 6px', color: '#5A2E22' }}>×</button>
          </div>
          <div style={{ overflowY: 'auto', padding: '6px 22px 20px' }}>
            {!needle && <h2 style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 22, margin: '10px 0 4px', color: '#5A2E22' }}>{all[ch].n}</h2>}
            {shown.length === 0 && <p style={{ fontStyle: 'italic', color: '#6B5A40' }}>Dazu steht nichts im Feldbuch.</p>}
            <dl style={{ margin: 0 }}>
              {shown.map(({ chapter, e }) => (
                <div key={chapter + e.t} style={{ padding: '10px 0', borderBottom: '1px dashed #CDB88A' }}>
                  <dt style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 16 }}>
                    {e.t}{needle && <span style={{ fontFamily: 'var(--body)', fontWeight: 400, fontSize: 11, color: '#8A7550', marginLeft: 8, textTransform: 'uppercase', letterSpacing: '.08em' }}>{chapter}</span>}
                  </dt>
                  <dd style={{ margin: '3px 0 0', fontFamily: 'var(--story)', fontSize: 15, lineHeight: 1.45 }}>{e.d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
