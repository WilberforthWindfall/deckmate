import { useEffect, useMemo, useRef, useState } from 'react';
import { LAND, type Land } from './map.ts';
import { AUTO_WIN, BUILDINGS, BUILDING_KEYS, COST, MAX_ARMY, ORDERS_PER_ROUND, SPEC_NAME } from './engine.ts';

type Entry = { t: string; d: string; tags?: string };
type Chapter = { n: string; icon: string; items: Entry[] };

const pct = (x: number) => `${Math.round((x - 1) * 100)} %`;

function chapters(): Chapter[] {
  return [
    {
      n: 'Befehle', icon: '✒', items: [
        { t: 'Befehl', d: `Jedes Haus gibt pro Runde bis zu ${ORDERS_PER_ROUND} Befehle. Sie werden geheim abgegeben, das Gerät geht dafür reihum. Danach werden alle Befehle beider Häuser gleichzeitig ausgeführt.` },
        { t: 'Ziehen', d: 'Das Heer marschiert in eine angrenzende Provinz. Ist sie leer, gehört sie dir. Steht dort ein fremdes Heer, wird angegriffen. Ziehen beide Häuser in dieselbe Provinz, besetzt sie eine klare Übermacht, sonst kommt es zur Feldschlacht.', tags: 'bewegen angreifen marsch' },
        { t: 'Unterstützen', d: 'Das Heer bleibt stehen und hilft einem eigenen Heer bei dessen Angriff oder Verteidigung in einer angrenzenden Provinz. Es zählt mit seiner halben Größe zur Stärke und bringt in einer Brett-Schlacht eine Extrakarte.', tags: 'hilfe support' },
        { t: 'Fouragieren', d: `Das Heer bleibt stehen und versorgt sich aus dem Land: Es wächst um 1 Figur, auf Ackerland um 2. Im Gebirge gibt es nichts zu holen. Ein Heer hat höchstens ${MAX_ARMY} Figuren. Praktisch, um ohne Gold Verluste auszugleichen.`, tags: 'fourage nahrung versorgung auffüllen' },
        { t: 'Rekrutieren', d: `Stadtbefehl für ${COST.recruit} Gold: Die Stadt stellt 3 neue Figuren auf, mit Kaserne 4. Sie stoßen erst nach dem Abmarsch dazu, also zum Heer, das in der Stadt bleibt, oder als neues Heer.`, tags: 'stadt truppen' },
        { t: 'Ausbilden', d: `Stadtbefehl für ${COST.train} Gold: Das Heer in der Stadt erhält einen Spezialisten. Dafür braucht die Stadt das passende Gebäude, und das Heer muss groß genug sein (jeder Spezialist braucht einen einfachen Soldaten daneben).`, tags: 'stadt spezialist' },
        { t: 'Bauen', d: 'Stadtbefehl: Die Stadt errichtet ein Gebäude. Es steht ab der nächsten Runde und bleibt auch bei Eroberung stehen – dann nutzt es der Eroberer.', tags: 'stadt gebäude' },
        { t: 'Stadtbefehl', d: 'Jede Stadt kann pro Runde genau einen Befehl ausführen: bauen, rekrutieren oder ausbilden. Er zählt zu deinen Befehlen der Runde.' },
        { t: 'Versiegeln', d: 'Schließt deine Befehle für diese Runde ab. Danach ist das andere Haus dran, ohne deine Befehle zu sehen.' },
      ],
    },
    {
      n: 'Kampf', icon: '⚔', items: [
        { t: 'Stärke', d: 'Größe des Heeres plus die halbe Größe aller Unterstützer. Verteidiger erhalten den Geländebonus ihrer Provinz und in einer Stadt mit Mauer weitere 30 %.' },
        { t: 'Übermacht', d: `Ist eine Seite mindestens ${AUTO_WIN}-mal so stark wie die andere, siegt sie ohne Schlacht. Sonst kommt es zur Schlacht.`, tags: 'auto-sieg automatisch' },
        { t: 'Schlacht auf dem Brett', d: 'Knappe Kämpfe werden als Deckmate-Partie ausgetragen. Der Angreifer führt die Offiziere, der Verteidiger die Mannschaft (höchstens 12 Steine). Jede Seite stellt selbst auf, welche Felder leer bleiben. Die Überlebenden kehren auf die Karte zurück.', tags: 'deckmate partie offiziere mannschaft' },
        { t: 'Auswürfeln', d: 'Schneller Ersatz für die Brett-Schlacht. Die Siegchance entspricht dem Stärkeverhältnis. Der Sieger verliert rund 30 % seiner Figuren, der Verlierer rund die Hälfte.', tags: 'würfel schnell' },
        { t: 'Extrakarte', d: 'Jedes unterstützende Heer gibt seiner Seite in der Brett-Schlacht eine zusätzliche Karte auf die Hand.', tags: 'karte unterstützung' },
        { t: 'Rückzug', d: 'Der Verlierer weicht in eine angrenzende eigene oder freie Provinz aus. Gibt es keinen Weg, löst sich das Heer auf. Ein abgewehrter Angreifer kehrt in seine Ausgangsprovinz zurück.', tags: 'flucht' },
        { t: 'Abprallen', d: 'Ziehen zwei Heere gegeneinander (Platztausch), begegnen sie sich unterwegs. Keines kommt an, beide bleiben stehen.', tags: 'platztausch' },
        { t: 'Wettlauf und Feldschlacht', d: 'Ziehen beide Häuser gleichzeitig in dieselbe Provinz, gewinnt eine mindestens 1,5-fache Übermacht kampflos, die andere Seite kehrt um. Ist es knapper, treffen sich die Heere im Feld: Das stärkere Heer führt die Offiziere (bei Gleichstand entscheidet der Würfel), der Sieger besetzt die Provinz, der Verlierer kehrt um. Gelände gibt dabei keinem Verteidigungsbonus.', tags: 'wettlauf feldschlacht gleichzeitig' },
      ],
    },
    {
      n: 'Heere', icon: '⚑', items: [
        { t: 'Heer', d: `Die Zahl auf der Fahne ist die Größe des Heeres (höchstens ${MAX_ARMY}). Der goldene Punkt zeigt, wie viele Spezialisten dabei sind. Treffen sich zwei eigene Heere, vereinen sie sich.`, tags: 'armee größe fahne' },
        { t: SPEC_NAME.CAP, d: `Höchstens 1 pro Heer. Ausbildung braucht eine ${BUILDINGS.messe.n}.`, tags: 'spezialist offizier' },
        { t: SPEC_NAME.KAP, d: `Höchstens 2 pro Heer. Ausbildung braucht eine ${BUILDINGS.kapelle.n}.`, tags: 'spezialist kaplan' },
        { t: SPEC_NAME.KAN, d: `Höchstens 2 pro Heer. Ausbildung braucht eine ${BUILDINGS.giesserei.n}.`, tags: 'spezialist kanone' },
        { t: SPEC_NAME.MAR, d: `Höchstens 2 pro Heer. Ausbildung braucht eine ${BUILDINGS.kaserne.n}.`, tags: 'spezialist marines' },
        { t: 'First Leutnant', d: 'Führt jedes angreifende Heer in der Brett-Schlacht an. Fällt er, ist die Schlacht verloren.' },
        { t: 'Fieber', d: 'Ein Heer, das am Rundenende im Sumpf steht, verliert 1 Figur.', tags: 'sumpf krankheit' },
      ],
    },
    {
      n: 'Land und Gold', icon: '⛁', items: [
        { t: 'Provinz', d: 'Ein Gebiet aus mehreren Hexfeldern. Sie gehört dem Haus, dessen Heer zuletzt darin stand, auch wenn das Heer weiterzieht. Die farbige Kontur zeigt die Reichsgrenze.', tags: 'besitz grenze' },
        { t: 'Stadt', d: 'Provinzen mit Wappen. Städte bringen mehr Gold und Punkte, können bauen, rekrutieren und ausbilden.' },
        { t: 'Hauptstadt', d: 'Stadt mit Krone. Wer die gegnerische Hauptstadt erobert, gewinnt die Kampagne sofort.', tags: 'sieg krone' },
        { t: 'Gold', d: 'In der Kopfleiste steht „verfügbar/gesamt“: was nach deinen geplanten Befehlen übrig bleibt. Das Gold des Gegners bleibt verdeckt.', tags: 'geld' },
        { t: 'Einkommen', d: `Am Rundenende: 1 Gold je Provinz, 2 je Stadt und +2 je ${BUILDINGS.markt.n}.`, tags: 'gold' },
        { t: 'Punkte', d: 'Provinz 1 Punkt, Stadt 3 Punkte. Nach der letzten Runde gewinnt, wer mehr Punkte hat.', tags: 'sieg wertung' },
      ],
    },
    {
      n: 'Gelände', icon: '⛰', items: (Object.keys(LAND) as Land[]).map((k) => {
        const l = LAND[k];
        const parts = [
          l.forage === 0 ? 'Keine Fourage.' : `Fourage +${l.forage}.`,
          l.defense > 1 ? `Verteidiger ${pct(l.defense)} stärker.` : '',
          l.battle === 'fluss' ? 'In der Schlacht gilt die Furt.' : l.battle === 'gebirge' ? 'In der Schlacht erhält der Verteidiger eine Karte mehr.' : l.battle === 'huegel' ? 'In der Schlacht beginnt der Verteidiger.' : '',
          k === 'S' ? 'Fieber: −1 Figur pro Runde.' : '',
        ].filter(Boolean);
        return { t: l.n, d: parts.join(' '), tags: 'gelände land' };
      }),
    },
    {
      n: 'Gebäude', icon: '⌂', items: BUILDING_KEYS.map((b) => ({ t: BUILDINGS[b].n, d: `${BUILDINGS[b].cost} Gold. ${BUILDINGS[b].effect}`, tags: 'gebäude bauen stadt' })),
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
