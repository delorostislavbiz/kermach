# Format des Boards „Roadmap“ (t510)

Deutsche Übersetzung von `FORMAT.md` (t1428). Dieses Board ist deutsch: im Kopf des Steckbriefs steht `lang: de`, die Formatwörter sind deutsch (Abschnitt „Board-Sprache“).
Das Board eines Projekts besteht aus einfachen Textdateien im Ordner `<Projekt>\.kermach\roadmap\`.
Man liest und ändert sie von Hand im Editor, der Agent schreibt sie direkt, das Programm zeigt sie in einem Panel.
Muster aller Dateiarten liegen im Ordner `samples.de\` neben dieser Beschreibung.

## Ordner

Alle Dateien liegen direkt in `.kermach\roadmap\`, ohne Unterordner.

| Datei | Was es ist | Wie viele |
|---|---|---|
| `passport.md` | Projektsteckbrief | eine |
| `f<N>.md` | Phase, zum Beispiel `f1.md` | eine Datei pro Phase |
| `t<N>.md` | Karte, zum Beispiel `t12.md` | eine Datei pro Karte |
| `d<N>.md` | Entscheidung, Sackgasse, Vereinbarung oder Muster-Eintrag, zum Beispiel `d3.md` | eine Datei pro Eintrag |
| `counter.json` | Nummernzähler | eine |

Die Projektübersicht ist `.kermach\обзор.md`, neben dem Board-Ordner, nicht darin: was der Agent vor dem Erstellen der Roadmap über das Projekt herausgefunden hat, mit einer Quelle für jede Tatsache. Der Dateiname `обзор.md` bleibt russisch: das Programm sucht ihn unter diesem Namen. Das Programm selbst liest die Übersicht nicht.

Namensregeln:
- `<N>` — nur Ziffern. `t09.md` und `t9.md` sind dieselbe Nummer 9; zwei solche Dateien gleichzeitig sind ein Fehler in beiden.
- Andere Namen im Ordner (`README.md`, `t12.bak`, `karte.md`, Unterordner) sind ein Fehler „falscher Name“.
  Eine Datei mit Fehler zeigt und ändert das Programm nicht, die übrigen werden gelesen.
- Namen mit einem Punkt am Anfang (`.t12.md.tmp`) oder mit `~` am Ende sind Hilfsdateien von Editoren, das Programm überspringt sie stillschweigend.
- Eine Datei größer als 256 KB ist ein Fehler „zu groß“, das Programm liest sie nicht.

## Wie eine Datei aufgebaut ist

Alle `.md` sind gleich aufgebaut:

```
---
schlüssel: wert
schlüssel: wert
---
# Titel
Text
```

Der Kopf steht zwischen zwei Zeilen `---` ganz am Anfang der Datei.
Im Kopf ist jede Zeile `schlüssel: wert`. Schlüssel in lateinischen Buchstaben, Werte in der Board-Sprache (hier deutsch, siehe „Board-Sprache“).
Ein leerer Wert ist nichts nach dem Doppelpunkt. Eine Liste steht in eckigen Klammern, durch Komma getrennt: `depends: [t09, t10]`.
Eigene Schlüssel darf man hinzufügen: das Programm lässt sie in Ruhe und behält sie beim Ändern.
Eine Kopfzeile ohne Doppelpunkt oder ohne schließendes `---` ist ein Fehler „kaputter Kopf“.

Nach dem Kopf folgen der Titel `# …` und der Text. Eine Zeile `# …` in einem Codeblock ```…``` ist kein Titel.
Der Buchstabe „ё“ in russischen Werten ist nicht nötig: „ждет ответа“ wird als „ждёт ответа“ gelesen.
Zeilenenden (LF oder CRLF) behält das Programm so, wie es sie vorgefunden hat.

Manche Wörter liest das Programm nur auf Russisch — auf einem deutschen Board schreibe sie genau so, auf Russisch:
- Werte von `effort` (`высокое` und die anderen aus der Kartentabelle), `advisor: да`, `draft: да`, `pick: человек`;
- im Steckbrief `card_mcp: все` / `никаких`, `card_skills` und `card_check` — `да` / `нет`; im Eintrag `pattern: нет`;
- die Textzeilen `Текст ошибки:`, `Неверно (tN): …`, `Проверено человеком (…)`, der Titel „Правило работы: …“, die Muster-Zeilen `Правило:`, `Почему:`, `Когда не так:`;
- die Abschnittsüberschriften `## Переносимый вывод`, `## Ответ человека (…)`, `## Вопрос`, die Zeile `Стек:` im Steckbrief.

## Karte — `t<N>.md`

Kopf:

| Schlüssel | Was es ist | Werte |
|---|---|---|
| `id` | Nummer, gleich dem Dateinamen | `t12` |
| `phase` | Phase | Phasennummer `f1`; leer — die Karte liegt im Eingang |
| `status` | Status | `in Warteschlange`, `in Arbeit`, `wartet auf Antwort`, `in Prüfung`, `im Review`, `pausiert`, `fertig` |
| `kind` | Art der Arbeit, danach wird die Prompt-Vorlage gewählt | `umsetzen`, `Review`, `Recherche`; kein Schlüssel — `umsetzen` |
| `agent` | wer es macht | `claude`, `codex` oder der Name eines eigenen Agenten |
| `model` | Modell | beliebig, zum Beispiel `opus`, `gpt-5.5`; leer — Standard des Agenten. Die Listen im Fenster stehen in `agents.js` |
| `effort` | Aufwand, optional | beliebig, zum Beispiel `высокое` (auf Russisch: so liest es `agents.js`); leer — Standard. Das Fenster kennt `минимальное`, `низкое`, `среднее`, `высокое`, `очень высокое`, `максимальное` |
| `advisor` | ob der Berater gerufen wird, optional | `да` — die Aufgabe der Karte bekommt die Zeile „rufe den Berater“, nur beim Ausführenden `claude`; kein Schlüssel oder etwas anderes — keine Zeile. Das Modell des Beraters setzt das Programm nicht: es kommt aus den Claude-Einstellungen (`advisorModel` in `~\.claude\settings.json`); steht es dort nicht, sagt der Agent, dass es keinen Berater gibt, und macht die Karte ohne ihn |
| `pick` | wer Modell und Aufwand gewählt hat, optional | `человек` — ein Mensch hat sie genannt, ein neuer Versuch erhöht sie nicht; kein Schlüssel — gewählt hat, wer die Karte angelegt hat, nach der Regel unten |
| `agent_why` | warum dieser Agent, dieses Modell, dieser Aufwand und Berater, optional | eine Zeile, zum Beispiel `Recherche — sonnet низкое` |
| `checked` | Ergebnis des Kartenprüfers, schreibt das Programm | eine Zeile, zum Beispiel `выполнено, круг 1: 4 из 4 критериев` oder `нужна доработка, круг 2 из 3: нет пробы для выкл`; die volle Auswertung — `.kermach/grades/tN-круг.md` (t1330) |
| `tries` | Nummer des Startversuchs, schreibt das Programm (t1440) | eine Zahl `1`, `2`, `3`…; wird bei jedem Start über „Starten“, `kermach roadmap run`, Welle und Stapel neu geschrieben. Bei einer fertigen Karte — mit welchem Versuch sie abgegeben wurde: danach fasst `kermach roadmap accept fN` die Stufen von `size.js` zusammen. Nicht von Hand ändern; kein Schlüssel — die Karte wurde vor t1440 oder nicht vom Programm gestartet |
| `depends` | von welchen Karten sie abhängt | Liste von Nummern `[t09, t10]` oder leer |
| `human` | ob ein Mensch nötig ist | `ohne Mensch`, `Mensch nötig` |
| `draft` | Entwurf, optional (t1325) | `да` — eine Karte einer späteren Phase ohne „Wie prüfen“: die Wellen „Alle“ und „Unabhängige“ überspringen sie mit dem Grund „Entwurf“, „Ausgewählte“ startet sie; die Kartenzeile im Panel trägt das Zeichen „Entwurf“. Kein Schlüssel — eine gewöhnliche Karte. Unten — „Kartenentwurf“ |
| `created` | wann angelegt | `2026-10-12 11:20` |
| `closed` | wann geschlossen, optional | `2026-10-12 15:40`; setzt der Agent beim Schließen, das Fenster beim Wechsel des Status auf „fertig“. Kein Schlüssel — in den Prompt einer Nachbarkarte der Phase (Teil 5) kommt diese Karte nur, wenn sie später angelegt ist (`created`), und die Kartenzeile auf dem Board hat keine Zeit: die Dateizeit nach `git clone` ist falsch |
| `source` | wer sie angelegt hat, optional | `von claude in Sitzung t15 gefunden`, `vom Menschen hinzugefügt` |
| `served` | welche Einträge das Programm dem Agenten in der Aufgabe gegeben hat; schreibt das Programm beim Kartenstart, der Agent fasst es nicht an | `[d12, d40]`; ein neuer Start ergänzt neue Nummern, die früheren bleiben |
| `from` | aus welcher Aufgabe der „Aufgaben“ die Karte stammt; schreiben `kermach tasks card kN` und der Knopf „In die Projekt-Roadmap“ (t1163). Wird die Karte geschlossen, wird die Aufgabe von selbst als erledigt markiert | `k12` |
| `used` | Rückmeldung des Agenten zu Einträgen, die geholfen haben, optional; schreibt der Agent beim Schließen | `помогла: d12 — dieselbe Ursache des Hängers gefunden; помогла: d40 — fertigen Probebefehl übernommen` (t1433); das Wort `помогла:` ist russisch, das Programm liest es; alte Karten haben `d12 помогла, d40 не пригодилась, d77 неверна, d81 не открывал`; ein Stück nicht nach dem Muster ist eine Board-Anmerkung, die Karte wird trotzdem gelesen |

Pflicht sind `id` und `status`, den Rest kann man weglassen.

Wer die Karte anlegt, wählt ihr den Agenten und, wenn gewünscht, Modell, Aufwand und Berater.
Der Agent ist `claude`, wenn der Mensch keinen anderen Ausführenden genannt hat.
Modell und Aufwand — die erste passende Zeile von oben:
1. Der Mensch hat Modell oder Aufwand selbst genannt — setze sie, bei jedem Ausführenden, und `pick: человек`.
2. Der Ausführende ist nicht `claude` (codex und andere) — `model` und `effort` leer.
3. Sonst schreibe `model` und `effort` nicht: die Stufe berechnet das Programm beim Start aus dem Kartentext (`size.js`, Entscheidung t1045) und schreibt den Grund ins Plugin-Protokoll und in die Zeile „nächster Start“ des Fensters. Eine Karte mit leeren Feldern „Was tun“, „Dateien“ und „Wie prüfen“ gilt als Stufe opus: wenig Daten — höhere Stufe.

| Stufe | Modell und Aufwand | Wann |
|---|---|---|
| opus | `opus`, `низкое` | Produktion oder Unumkehrbares; Ursache unbekannt oder Verhalten schwankend; Gesten, Fokus, Reihenfolge von Ereignissen, Zeit; Architektur, Protokoll, Daemon; 4 und mehr Dateien in `src`; eine Prüfung mit 4 und mehr Punkten; Änderung mehrerer Dateien in `src` ohne genaue Stellen |
| sonnet | `sonnet`, `низкое`, der Berater einmal vor der Abgabe | der Rest: Recherche und Review ohne Änderung von `src`; Text, Prüfungen, Proben ohne `src`; Änderung von `src` an bekannter Stelle (Datei:Zeile) |
| haiku | `haiku` | nur auf das Wort des Menschen (`pick: человек`): der Titel beginnt mit einem Navigationsverb — finden, sammeln, verschieben, umbenennen, messen, zählen — und `src` wird nicht angefasst. Das Programm setzt haiku nie selbst, es gibt nur einen Hinweis im Protokoll |

Der Berater wird getrennt vom Modell gesetzt und nur beim Ausführenden `claude`. Einer Karte der Stufe sonnet gibt das Programm die Zeile „rufe den Berater einmal vor der Abgabe“ selbst (t1042: ohne Berater hat Sonnet in 4 von 4 Läufen einen versteckten Fehler abgegeben, mit Berater in 0 von 4). Schreibe `advisor: да` bei Produktion, Geld, Unumkehrbarem und wenn ein Mensch den Berater verlangt: dann lautet die Zeile „vor der ersten Änderung und vor dem Schließen“, bei jedem Modell. Codex und andere Ausführende haben keinen Berater — setze den Schlüssel `advisor` nicht; das Programm gibt ihnen die Berater-Zeile auch nicht.
Ein neuer Versuch nach „wartet auf Antwort“ geht eine Stufe höher auf der Leiter `sonnet низкое → opus низкое → opus среднее`; eine Karte mit `pick: человек` wird nicht erhöht.
Den Grund der Wahl schreibe in einer Zeile in `agent_why`, wenn ein Mensch oder der Orchestrator das Modell gewählt hat: was gesagt wurde und warum.

Neuer Versuch. Die Karte wird nach „wartet auf Antwort“ erneut gestartet (rote Prüfung, Frage, der Agent hat ohne „fertig“ aufgehört) — das Programm nimmt eine Stufe höher: `sonnet низкое` → `opus низкое` → `opus среднее` (`LADDER` in `agents.js`).
In der Kartendatei ändern sich `model` und `effort` nicht: die Stufe geht nur in die Argumente des Tabs, die Zeile darüber ins Plugin-Protokoll. Nicht erhöht wird eine Karte mit `pick: человек`, nicht claude, oder mit Modell oder Aufwand nicht von dieser Leiter.
Wie die Versuche gezählt werden:
- der Versuch kam bis „wartet auf Antwort“ — der nächste Start eine Stufe höher. Egal, wer diesen Status gesetzt hat: der Agent, das Programm nach dem Tab oder ein Mensch im Fenster;
- der Mensch hat im selben Tab geantwortet und der Agent ist wieder „in Arbeit“ — das ist derselbe Versuch, das Zeichen „kam bis zur Antwort“ wird entfernt;
- der Tab wurde mitten in der Arbeit geschlossen („pausiert“), die Karte ging „in Prüfung“ oder „im Review“ — die Zählung ändert sich nicht;
- die Karte wurde „fertig“ oder zurück „in Warteschlange“ gelegt — die Zählung beginnt von vorn.
`pick: человек` setzt das Programm selbst, wenn ein Mensch im Fenster Modell oder Aufwand auf nicht leere Werte ändert. Das Zurücksetzen des Modells beim Agentenwechsel setzt `pick` nicht.

Text: der Titel `# …` ist der Name der Karte. Darunter — beschriftete Zeilen.

Der Name ist für den Menschen. Allein aus dem Namen versteht ein Mensch, was sich nach der Karte ändert: was anders funktioniert oder was dazukommt.
Einfache Wörter, bis etwa 80 Zeichen. Ohne interne Namen — Funktionen, Dateien, Variablen, Schlüssel, Probennummern — und ohne Jargon: die gehören in „Was tun“.
Schlecht → gut:
- „"не открывал" in --used — vierter Befund für den Abgleich t1329“ → „Der Abgleich zählt den Nutzen von Notizen genauer: der Agent markiert, welche er nicht geöffnet hat“;
- „Proben: Ergebnis des Kindprozesses nach exit, nicht nach close“ → „Prüfungen verlieren die Ausgabe des Programms unter Last nicht“;
- „Gate in 2–3 Threads: Prüfungen ohne Fenster parallel“ → „Das Gate ist schneller: Prüfungen ohne Fenster laufen zu dritt“.
Die Beschriftung steht am Zeilenanfang, mit Doppelpunkt; der Text folgt nach dem Doppelpunkt und kann auf den nächsten Zeilen weitergehen.
Ein Feld endet an der nächsten Beschriftung der Liste, an einer Leerzeile oder an einer Überschrift.
Ein Codeblock ```…``` ist Teil des Feldes, so wie er ist: Leerzeile, `#` und Beschriftung im Block beenden das Feld nicht. Der Block beginnt auf einer neuen Zeile nach der Beschriftung.

| Beschriftung | Schlüssel im Programm |
|---|---|
| `Was tun:` | `what` |
| `Wozu:` | `why` |
| `Dateien:` | `files` |
| `Wie prüfen:` | `check` |
| `Besondere Hinweise:` | `notes` |
| `Was erledigt wurde:` | `done` |
| `Nachweis:` | `proof` |

„Wie prüfen“ — Befehl und erwartetes Ergebnis, wenn über die Projektprüfung aus dem Steckbrief hinaus etwas nötig ist.
„Wie prüfen“ misst das Ziel der Karte, nicht nur das Fehlen von Fehlern (t1434). Ist das Ziel die Übereinstimmung mit einer Vorlage (Markup, Mockup, Design, alte Seite), vergleicht die Prüfung die ganze Seite von oben bis unten mit ihr: jeder Abschnitt der Vorlage ist auf der Seite oder auf Antwort des Menschen entfernt.
„Öffnet sich ohne Fehler“, „ohne fatal“, „ein H1“ reicht für so eine Karte nicht: der Prüfer gibt sie mit dem Ergebnis „Kriterien passen nicht“ zurück. Schlecht → gut: „die Startseite öffnet sich ohne fatal, ein H1“ → „die Startseite öffnet sich ohne fatal; die Abschnitte von oben bis unten stimmen mit html/index.html überein: 12 von 12, ein Bild der ganzen Seite neben einem Bild der Vorlage“.
„Was erledigt wurde“ und „Nachweis“ werden beim Schließen ausgefüllt; der Nachweis ist eine Befehlsausgabe, ein Commit oder Datei und Zeile.
Ein leeres Feld ist ein Strich `—` oder nichts.
Eigenen Text schreibe nach einer Leerzeile: dann wird er nicht Teil eines Feldes, und das Programm fasst ihn nicht an.

```
---
id: t12
phase: f1
status: in Warteschlange
agent: codex
depends: [t09]
human: ohne Mensch
---
# Warenkorb: Neuberechnung der Lieferung
Was tun: beim Wechsel der Stadt im Warenkorb wird die Lieferung ohne Neuladen neu berechnet.
Wozu: jetzt hinkt der Lieferpreis einen Schritt hinterher, Käufer gehen (Beschwerde 09.10).
Dateien: `theme/js/cart.js`, `inc/shipping.php`.
Wie prüfen: `remote-check.sh` grün; von Hand — Stadt wechseln, der Preis ändert sich sofort.
Besondere Hinweise: `theme/js/city.js` nicht anfassen.
Was erledigt wurde: —
Nachweis: —
```

### Antwort des Menschen (t1354)
Die Antwort auf die Frage des Agenten ist ein Abschnitt am Ende der Karte. Ihn schreibt das Programm, nicht jemand von Hand:
- die Hauptsitzung oder ein Mensch im Terminal — `kermach roadmap answer tN "Text"` (oder `-`: Text von der Standardeingabe);
- das Panel „Roadmap“ — der Plugin-Befehl `answer`.

Die Überschrift des Abschnitts ist russisch, `## Ответ человека (…)`: daran findet das Programm die Antwort.

```
## Ответ человека (26.10 22:40)
Variante 1: der Prüfer glaubt nur Antworten, die das Programm geschrieben hat.
```

Der Abschnitt endet an der nächsten Überschrift oder Feldbeschriftung. Im Text darf keine Zeile mit `#`, ```` ``` ```` oder einer Feldbeschriftung beginnen: der Befehl lehnt ab.
Zusammen mit dem Abschnitt schreibt das Programm einen Fingerabdruck des Textes (sha1 von Projekt, Kartennummer und Text) in `answers.json` im Datenordner von Kermach (`%APPDATA%\Kermach\plugins-data\roadmap\`), nicht im Projektordner.
Der Kartenprüfer (`card_check`) sieht nur Antworten mit Fingerabdruck. Ein von Hand in die Karte geschriebener Abschnitt und Zeilen wie „Ответ оркестратора …“ sind keine Antwort für den Prüfer: sie heben kein Kriterium auf. Der Agent der Karte sieht sie weiterhin im Prompt.
Den Text des Abschnitts nach dem Schreiben ändern, in eine andere Karte verschieben oder den Projektordner umbenennen — der Fingerabdruck passt nicht mehr, die Antwort muss neu geschrieben werden.
Aus dem Tab des Kartenagenten (`KERMACH_CARD` in der Umgebung) lehnt der Befehl `answer` mit Code 5 ab: die Antwort des Menschen schreibt sich der Agent nicht selbst.
Das schützt vor einem Fehler des Agenten, nicht vor Täuschung. Der Agent läuft unter demselben Windows-Benutzer wie das Programm: `KERMACH_CARD` aus der Umgebung entfernen oder `answers.json` selbst schreiben kann er. Ein Schloss über den Hauptprozess gibt es absichtlich nicht: das Schreiben einer Datei im Datenordner verhindert es ohnehin nicht.

### Kartenentwurf (t1325)
Die Roadmap wird vorab vollständig geschrieben: die erste Phase als volle Karten, der Rest als Entwürfe. Ein Entwurf ist eine Karte mit `draft: да` im Kopf und `status: in Warteschlange`.
Er hat Titel, „Was tun“, „Wozu“, „Dateien“; „Wie prüfen“ ist leer oder ein Strich. Einzelheiten und „Wie prüfen“ werden beim Abgleich nach der vorigen Phase ergänzt: nach dem, was man bei der Arbeit erfahren hat.
Ist das ergänzt, wird der Schlüssel `draft` aus dem Kopf entfernt, und die Karte wird gewöhnlich. Eine Welle nimmt sie erst danach: der Agent bekommt keine Karte ohne „Wie prüfen“.
Warum ein Feld und kein Status. Ein Entwurf ist „in Warteschlange, aber nicht ausgeschrieben“. Einen neuen Status müsste man allen beibringen, die den Status lesen: der Kartenzählung der Phase, dem Phasenbericht, `kermach roadmap`, den Übersetzungen, der Bearbeitung im Fenster. Das Feld sehen nur die Welle und die Kartenzeile im Panel.

### Phasen-Review-Karte (t1325)
Die letzte Karte jeder Phase ist `kind: Review`, `depends` — alle anderen Karten der Phase. Ein frischer Agent prüft, wie die Arbeit der Nachbarkarten zusammenpasst.
Ihr „Wie prüfen“ ist jedes Fertig-Kriterium der Phase Punkt für Punkt: ja oder nein und womit belegt (Befehl, Datei und Zeile, Seite). In einer Entwurfsphase ist auch das Review ein Entwurf.
Die Kriterien werden in Worten ausgeschrieben, nicht als Verweis „nach jedem Kriterium der Phase“: die Roadmap-Prüfung sucht in „Wie prüfen“ die Wörter jedes Kriteriums.

### Roadmap-Prüfung (t1437)
Das Programm prüft das Board ohne KI: `kermach roadmap check [fN]` (ohne fN — unfertige Phasen; Fehler — Code 4).
Dieselbe Prüfung läuft von selbst an zwei Stellen: wenn der Ersteller die Karten geschrieben und `kermach roadmap start --summary` aufgerufen hat (das Ergebnis — in seine Ausgabe, in die Aufgabe der Hauptsitzung und als Zeile unter der Phase) und vor dem Start der Welle einer Phase.
Was als Fehler gilt:
- eine Phase ohne Karte `kind: Review` oder ohne Fertig-Kriterien;
- eine Karte der Phase ohne „Wie prüfen“ oder ohne „Dateien“ (leer oder ein Strich). Ein Entwurf (`draft: да`) und eine Karte „fertig“ zählen nicht;
- eine Review-Karte, in deren „Wie prüfen“ die Kriterien der Phase fehlen: ein Kriterium gilt als gefunden, wenn der Text mindestens die Hälfte seiner Wörter enthält;
- `depends` auf eine Karte, die es auf dem Board nicht gibt;
- ein Abhängigkeitsring: t1 wartet auf t2 und t2 wartet auf t1 (oder länger; eine Karte, die auf sich selbst wartet, ist auch ein Ring).
Gibt es Fehler, startet die Welle der Phase nicht: unter der Phase die Zeile „Welle nicht gestartet: die Roadmap-Prüfung hat Fehler gefunden“ mit der Liste.
Mit ihnen starten darf nur ein Mensch, mit dem Knopf „trotzdem starten“ in derselben Zeile. `kermach roadmap wave fN` antwortet dann mit Code 4 und zählt die Fehler auf.
Die Welle „Ausgewählte“ prüft nur die ausgewählten Karten: Review und Kriterien der Phase braucht sie nicht. Das Fortsetzen einer unterbrochenen Welle wird nicht geprüft: sie wurde schon gestartet.
Sind die Karten korrigiert, verschwindet die Zeile beim nächsten Lesen des Boards von selbst.

### Frischer Roadmap-Prüfer (t1438)
Das Programm fängt Formfehler. Inhaltsfehler — eine Karte bewegt kein Kriterium der Phase, eine Prüfung misst nicht das Ziel — fängt ein frischer Agent: der Ersteller sieht seine eigenen Fehler schlecht.
Wann: der Ersteller hat `kermach roadmap start --summary` aufgerufen, die Programmprüfung hat keine Fehler gefunden, und der Tab des Erstellers lebt. `start` aus dem Terminal eines Menschen, ohne Tab des Erstellers, öffnet die Hauptsitzung sofort, wie bisher.
Wer: ein eigenes `claude -p`, Modell opus, Aufwand „hoch“, nur lesen (Read, Glob, Grep). Die Aufgabe ist die Vorlage `review-roadmap.md` neben dieser Datei (auf Deutsch — `review-roadmap.de.md`), die eigene Kopie liegt im Datenordner des Plugins, wie bei `compose.md`.
Was er prüft:
- jede Karte hat ein Fertig-Kriterium ihrer Phase — das Feld „Wozu“ nennt es; jedes Kriterium hat eine Karte;
- das Kriterium ist in der Praxis sichtbar: Befehlsausgabe, Seite, Datei; „alle Karten geschlossen“ ist kein Kriterium;
- „Wie prüfen“ misst das Ziel der Karte, nicht „öffnet sich ohne Fehler“;
- gibt es eine Vorlage, endet die erste Phase mit einem Piloten mit vollem Seitenabgleich, jede Phase mit Seiten hat ein Kriterium des Abgleichs mit der Vorlage;
- Abschnitte der Vorlage ohne Daten: die Antwort des Menschen steht in der Übersicht, bevor die Karten dieser Seiten angelegt werden;
- Reihenfolge der Phasen und Abhängigkeiten, eine Zugangskarte bei Karten mit Server.

Höchstens zwei Runden:
- solange eine Runde läuft, antwortet `start` mit Code 4 und dem Text „проверка роадмапа идёт“ (die Roadmap-Prüfung läuft) — der Tab der Hauptsitzung wird nicht geöffnet;
- das Ergebnis der Runde druckt das Programm in einer Zeile „[Роадмап] Проверка роадмапа, круг N из 2: …“ (Roadmap-Prüfung, Runde N von 2) mit dem Pfad zur Auswertung in den Tab des Erstellers. Kam die Zeile nicht an (ein Mensch tippt lange Text, der Tab hat sie nicht angenommen), gibt der nächste `start` sie als Antwort zurück und beginnt keine neue Runde;
- ernste Anmerkungen — der Ersteller korrigiert das Board und ruft `start` noch einmal auf: die zweite Runde;
- sauber, die zweite Runde ist vorbei oder die Prüfung fand nicht statt (Limit, kein claude, länger als 20 Minuten) — der nächste `start` öffnet die Hauptsitzung. Was übrig ist und warum die Prüfung nicht stattfand, steht in ihrer Aufgabe: sie sagt es dem Menschen.
Ernst — eine Karte ohne Kriterium der Phase, ein Kriterium ohne Karte, das Kriterium „alle Karten geschlossen“, eine Prüfung des falschen Ziels, kein Pilot oder Abgleich mit der Vorlage, ein Abschnitt ohne Antwort des Menschen, eine fehlende nötige Abhängigkeit. Der Rest ist klein, für den Menschen in der Zusammenfassung.
Die Auswertung jeder Runde — `.kermach\grades\roadmap-N.md` im Projektordner (die nächste freie Nummer, nicht für git). Die Runde merkt sich das Programm: erneutes Öffnen des Fensters beginnt die Prüfung nicht neu, ein neuer Tab des Erstellers beginnt mit Runde 1.
Der Prüfer belegt einen der zwei Plätze der Kartenprüfer: laufen zwei Kartenprüfungen, wartet er, bis er an der Reihe ist.

Eine Welle startet nicht zwei Karten mit einer gemeinsamen Datei zusammen. Eine gemeinsame Datei ist ein Pfad in den „Dateien“ beider Karten, derselbe Dateiname oder ein Ordner, in dem eine Datei der anderen Karte liegt.
Die zweite Karte wartet mit dem Zeichen „wartet auf Datei: tNN“, solange die erste arbeitet, auf Antwort wartet, in Prüfung oder im Review ist; sie startet, wenn die erste „fertig“ wurde und ihre Prüfung vorbei ist.
Auch eine Karte, die nicht durch eine Welle gestartet wurde, hält die Datei.

### Frischer Phasen-Prüfer (t1439)
Spätere Phasen werden als Entwürfe geschrieben und nach der vorigen Phase ergänzt, und bei ihrer Abnahme bringt der Mensch Änderungen ein. Die Roadmap-Prüfung am Anfang sieht das nicht. Deshalb prüft vor dem Start einer Phase derselbe frische Agent sie — nur diese Phase.
Wann: die erste Welle der Phase (`kermach roadmap wave fN` oder der Wellenknopf „Alle“ oder „Unabhängige“), wenn die Programmprüfung keine Fehler gefunden hat, die vorige Phase vorbei ist — `status: fertig` oder alle ihre Karten „fertig“ — und in dieser Phase noch keine Karte gestartet wurde (alle „in Warteschlange“ oder „pausiert“).
Die erste Phase prüft er nicht: die hat der Roadmap-Prüfer geprüft. „Ausgewählte“ und „trotzdem starten“ sind eine Entscheidung des Menschen, eine Prüfung gibt es nicht.
Wer: dasselbe `claude -p` wie bei der Roadmap. Die Aufgabe ist der Abschnitt „## Проверка фазы“ in `review-roadmap.md` (die Überschrift ist auch in der Übersetzung russisch: daran findet das Programm den Abschnitt); fehlt dieser Abschnitt in der eigenen Kopie, wird der eingebaute genommen.
Was er prüft:
- in der Phase gibt es keine Entwürfe (`draft: да`): die Welle würde sie stillschweigend überspringen;
- jede Karte hat „Wie prüfen“, und es misst das Ziel der Karte;
- die Änderungen des Menschen aus der Abnahme der vorigen Phase sind bei den Karten angekommen: die Hauptsitzung schreibt sie in „Jetzt“ als Zeile „Правки приёмки для fN: …“;
- die Kriterien der Phase decken die Karten ab und umgekehrt, die letzte Karte ist ein Review;
- die Karten stützen sich nicht auf etwas, das die vorige Phase nicht gemacht hat.

Der Ablauf ist derselbe wie bei der Roadmap, nur ist der Tab der der Hauptsitzung und der Befehl `wave`:
- solange eine Runde läuft, antwortet `wave` mit Code 4 und dem Text „проверка фазы идёт“ (die Phasenprüfung läuft) — keine Welle;
- das Ergebnis der Runde — als Zeile „[Роадмап] Проверка фазы fN, круг K из 2: …“ im Tab der Hauptsitzung. Kam eine Zeile mit Anmerkungen oder über einen Ausfall nicht an, gibt der nächste `wave` sie als Antwort zurück;
- ernste Anmerkungen — die Hauptsitzung korrigiert die Karten und ruft `wave` noch einmal auf: die zweite Runde;
- sauber, die zweite Runde ist vorbei oder die Prüfung fand nicht statt — der nächste `wave` startet die Welle. Was nach der zweiten Runde übrig ist, zeigt die Hauptsitzung dem Menschen vor dem Start.
Die Auswertung jeder Runde — `.kermach\grades\phase-fN-K.md`. Die Runde merkt sich das Programm: erneutes Öffnen des Fensters beginnt die Prüfung nicht neu.

## Phase — `f<N>.md`

Die Phasen folgen der Reihenfolge der Nummern: `f1`, `f2`, …

| Schlüssel | Was es ist | Werte |
|---|---|---|
| `id` | Nummer, gleich dem Dateinamen | `f1` |
| `status` | Status | `geplant`, `läuft`, `fertig` |
| `health` | Zustand | `grün`, `gelb`, `rot` oder leer |
| `health_why` | eine Zeile, warum dieser Zustand | Text |
| `health_by` | wer ihn gesetzt hat | `Mensch`, `codex` |
| `health_at` | wann | `2026-10-11 14:02` |

Pflicht sind `id` und `status`.
Text: `# …` — der Name der Phase. Die Beschriftung `Ziel:` — das Ziel der Phase.
Die Beschriftung `Fertig-Kriterien:` — darunter eine Liste, ein Kriterium pro Zeile: `- [ ] …` nicht abgehakt, `- [x] …` abgehakt.
Eine Zeile `- [ ]` in einem Codeblock ```…``` ist ein Beispiel, kein Kriterium: das Fenster zeigt sie nicht und ein Klick ändert sie nicht.
Eine Phase ist fertig, wenn alle Kriterien abgehakt sind, nicht wenn die Karten ausgegangen sind.
Gibt es eine Vorlage (Markup, Mockup, Design, alte Seite), haben die erste Phase und jede spätere, die Seiten ändert, das Kriterium „die Seiten der Phase stimmen über die ganze Seite mit der Vorlage überein: jeder Abschnitt ist da oder auf Antwort des Menschen entfernt“ (t1434). Der Abgleich wird nicht in die letzte Phase verschoben und nicht auf den ersten Bildschirm beschränkt.

```
---
id: f1
status: läuft
health: grün
health_why: Prüfung grün, geschlossene Karten ohne Rückgaben
health_by: Mensch
health_at: 2026-10-11 14:02
---
# Warenkorb
Ziel: der Käufer stellt eine Bestellung zusammen und sieht vor dem Bezahlen einen ehrlichen Preis mit Lieferung.
Fertig-Kriterien:
- [x] Die Stadt wird gewählt und im Warenkorb gespeichert
- [ ] Die Lieferung wird beim Wechsel der Stadt neu berechnet
```

## Steckbrief — `passport.md`

Der feste Teil über das Projekt, einer für alle Karten. Im Kopf stehen die Board-Sprache (`lang: de`, Abschnitt „Board-Sprache“) und, wenn gewünscht, die Starteinstellungen des Kartenagenten (t1322):

```
---
lang: de
card_mcp: никаких
card_skills: нет
---
```

| Schlüssel | Wert | Was er bewirkt |
|---|---|---|
| `card_mcp` | `все` · `никаких` · Namen durch Komma: `playwright, context7` | MCP-Server des Kartenagenten. `никаких` — das claude-Flag `--strict-mcp-config`. Eine Liste — nur diese Server: das Programm schreibt ihre Datei selbst aus den Claude-Einstellungen (`.claude.json` und `.mcp.json` des Projekts) und übergibt sie an `--mcp-config`; die Datei wird gelöscht, wenn der Tab des Agenten beendet ist. Server aus Claude-Plugins und claude.ai-Konnektoren findet die Liste nicht — eine Karte mit ihnen startet nicht: für sie `все`. |
| `card_skills` | `да` · `нет` | `нет` — Skills und „/“-Befehle aus: das claude-Flag `--disable-slash-commands`. |
| `card_check` | `да` · `нет` | Kartenprüfer (t1330). `да` — eine Karte, die der Agent aus „Starten“ geschlossen hat, prüft ein eigenes `claude -p` (sonnet, niedrig, nur lesen): er sieht „Was tun“, „Wie prüfen“ und die Änderungen seit Beginn der Karte, das Gespräch des Agenten sieht er nicht. Das Ergebnis ist die Zeile `checked:` in der Karte. „Nacharbeit nötig“ — die Anmerkungen gehen in den Tab des Agenten, die Karte ist wieder „in Arbeit“, höchstens 3 Runden, nach der dritten — „wartet auf Antwort“. „Kriterien passen nicht“ — „wartet auf Antwort“. Karten der Art `Review` und `Recherche` ohne Befehl in „Wie prüfen“ werden nicht geprüft. |

Die Werte dieser drei Schlüssel sind russisch, wie in der Tabelle: so liest sie das Programm.
Kein Schlüssel — `все` und `да`, wie vor t1322 (bei `card_check` — `да`: die Prüfung ist an). Ein falscher Wert wirkt nicht, Fenster und Protokoll der „Roadmap“ warnen davor.
Subagenten sind dem Kartenagenten immer verboten, eine Einstellung dafür gibt es nicht: claude startet mit `--disallowedTools=Agent`.
Die Flags gibt es nur bei claude; bei codex und anderen Agenten wirkt die Einstellung nicht, das Protokoll schreibt eine Zeile dazu.
Der Text sind neun Abschnitte, jeder mit einer Überschrift `## `. In den Abschnitten stehen Verweise auf Projektdateien, keine Nacherzählung.
Ein leerer Abschnitt ist eine Überschrift ohne Text; das Programm zeigt ihn als „leer“.

| Überschrift des Abschnitts | Schlüssel im Programm |
|---|---|
| `## Transport und Server` | `transport` |
| `## Projektwerkzeuge` | `tools` |
| `## Prüfbefehl und erwartetes Ergebnis` | `check` |
| `## Cache nach einer Änderung` | `cache` |
| `## Verbindungsabbruch` | `disconnect` |
| `## Muster und Kanon` | `samples` |
| `## Nicht anfassen` | `keep` |
| `## Pflicht außer grüner Prüfung` | `required` |
| `## Protokoll` | `journal` |

Eine Nummer vor dem Namen ist erlaubt: `## 3. Prüfbefehl und erwartetes Ergebnis`. Ein Doppelpunkt am Ende auch: `## Protokoll:`. Groß- und Kleinschreibung spielt keine Rolle. Die russischen Überschriften (`## Транспорт и сервер`) liest das Programm auch.
Zeilen in einem Codeblock ```…``` sind Text des Abschnitts: `## …` und `# …` sind dort keine Überschriften. Ein nicht geschlossenes ``` gilt nicht als Block.
Ein einzelnes ``` bildet ein Paar mit dem nächsten ``` darunter, wie in Markdown, und die Abschnitte dazwischen werden Text des Blocks. Das Fenster warnt vor so einem Abschnitt, und „Speichern“ schreibt ihn nicht, bis der Block in der Datei geschlossen ist.
Ein Abschnitt mit eigener Überschrift bleibt, wie er ist.

## Entscheidung, Sackgasse, Vereinbarung oder Muster-Eintrag — `d<N>.md`

| Schlüssel | Was es ist | Werte |
|---|---|---|
| `id` | Nummer, gleich dem Dateinamen | `d3` |
| `type` | Art des Eintrags | `Entscheidung`, `Sackgasse`, `Vereinbarung` — eine Vereinbarung mit dem Menschen oder eine Arbeitsregel für alle Karten (womit Dateien geändert werden, wie gestartet wird), vom Menschen bestätigt; `Muster` — der Muster-Eintrag: eine Regel, die Verallgemeinerung von 3+ Einträgen über eine Ursache; `Notiz` — ein Fund am Rande, der jetzt nicht stört (t1046): wird Agenten nicht gegeben, geht nicht in Muster ein, eine Karte daraus legt der Mensch an |
| `card` | Karte, auf der es gefunden wurde | `t12` oder leer |
| `files` | welche Dateien es betrifft | Liste `[src/cart/delivery.ts]` |
| `date` | wann | `2026-10-12` |
| `agent` | wer es geschrieben hat | `codex`, `Mensch` |
| `how` | wie verlässlich | `geprüft` — durch einen Lauf bestätigt, `Vermutung` — nicht; oder leer |
| `until` | Haltbarkeit: der letzte Tag, an dem der Eintrag gilt | `2026-12-31` oder leer — unbefristet |
| `repeats` | Karten, auf denen dieselbe Ursache wieder gefunden wurde | Liste `[t40, t55]` oder leer |
| `cancelled` | Datum der Aufhebung: der Eintrag gilt nicht mehr, bleibt aber in der Geschichte | `2026-10-15` oder leer |
| `differs` | Einträge, denen dieser nicht ähnelt: ein Mensch hat neben dem Zeichen „ähnlich wie dN“ auf „nicht ähnlich“ gedrückt, das Fenster markiert dieses Paar nicht mehr | Liste `[d32]` oder leer |
| `wrong` | Karten, deren Agent den Eintrag als „falsch“ markiert hat | Liste `[t901]` oder leer; zu jeder eine Zeile `Неверно (t901): warum` im Text (das Wort `Неверно` ist russisch), ohne sie wirkt die Markierung nicht (Board-Anmerkung) |
| `stack` | wessen Code schuld ist: Theme, Plugin, Bibliothek | Liste `[woocommerce, woodmart@8.1]` oder leer: der Name in Kleinbuchstaben (a-z, Ziffern, `.` `-` `_` `/`, `@scope/` am Anfang), eine Version nach `@` nach Wunsch |
| `from` | beim Muster-Eintrag: aus welchen Einträgen er gebildet ist | Liste `[d77, d97, d136]` |
| `approved` | beim Muster-Eintrag: der Tag, an dem der Mensch ihn bestätigt hat | `2026-10-16` oder leer — wartet auf Bestätigung |
| `pattern` | der Mensch hat „kein Muster“ gesagt: der Eintrag wird nicht mehr zum Bilden eines Musters angeboten | `нет` (auf Russisch) oder leer |
| `for` | bei einer Vereinbarung: für wen sie ist (t1433) | `Agent` — eine Arbeitsregel des Kartenagenten; `Programm` — für Programm und Orchestrator (welches Modell gestartet wird, wie das Board geführt wird): wird dem Kartenagenten nicht gegeben; leer — dem Agenten |

Pflicht sind `id` und `type`. Ein leerer Wert ist dasselbe wie kein Schlüssel: Einträge ohne die neuen Schlüssel werden gelesen wie bisher.
Ein falscher Wert ist ein Dateifehler, wie bei einer Karte: `how` nicht aus der Liste, `until` oder `cancelled` kein echtes Datum `JJJJ-MM-TT`, in `repeats` und `wrong` nicht `t<Nummer>`, in `differs` und `from` nicht `d<Nummer>`, `approved` kein Datum, `pattern` nicht `нет`, `for` weder `Agent` noch `Programm`.
Dem Kartenagenten gibt das Programm keinen Eintrag mit `cancelled`, keinen Eintrag `type: Notiz`, keine Vereinbarung mit `for: Programm` und keinen Eintrag, dessen `until` vor heute liegt; `until` mit dem heutigen Tag gilt noch.
Eine Notiz ist ein Fund für den Menschen: sie wartet im Eingang des Fensters „Roadmap“, eine Karte daraus legt der Mensch an; in den Kartenprompt und in `kermach roadmap notes` geht sie nicht.
Ein Eintrag mit `wrong` (und der Zeile „Неверно (tN): …“) wird Agenten auch nicht gegeben, bis ein Mensch ihn angesehen hat: die Liste ist `kermach roadmap notes --wrong`. Ist der Eintrag richtig, leert der Mensch `wrong`, die Zeile „Неверно…“ bleibt als Geschichte; ist er falsch, setzt er `cancelled` (t836).
Hat ein Mensch nachgesehen und den Eintrag für richtig befunden, wird die Zeile „Неверно (tN): …“ zu „Проверено человеком (JJJJ-MM-TT): верна, отзыв tN снят“ (so schreibt es das Programm, auf Russisch), tN verlässt `wrong`, und der Eintrag wird wieder gegeben. Das Zusammenführen überträgt `wrong` des Duplikats samt seinen Zeilen „Неверно“ in den alten Eintrag.
Beim Schließen einer Karte schreibt der Agent in ihren Kopf `used:` — nur die Einträge, die geholfen haben, und womit (t1433): `помогла: d12 — dieselbe Ursache des Hängers gefunden; помогла: d40 — fertigen Probebefehl übernommen`. Teile durch `;`; alles nach dem Strich ist Erklärung, Nummern darin zählen nicht als Rückmeldung. „Womit“ — mindestens zwei Wörter ab drei Buchstaben, außer Nummern und den Wörtern „помогла“, „пригодилась“: `kermach roadmap close` lehnt ohne das mit Code 1 ab und schreibt, wie es richtig geht. Einträge, die nicht geholfen haben, zählt der Agent nicht auf; hat keiner geholfen — kein `used`.
Alte Karten mit `d12 помогла, d40 не пригодилась, d77 неверна, d81 не открывал` werden wie bisher gelesen, ohne Anmerkung: die strenge Prüfung gibt es nur beim Schließen. Ein Eintrag hat sich als falsch erwiesen — das ist die Markierung `wrong` im Kopf des Eintrags, keine Rückmeldung.
Kartenprompt, Teil 5 „Notizen zur Aufgabe“ (vor t1433 gingen die Einträge in zwei Teile: 5 „Frisch“ — Entscheidungen und Sackgassen nach Datum, und 6). Der Reihe nach: Vereinbarungen für den Agenten — an jede Karte, im vollen Text, ohne Auswahl nach Dateien und Datum; bestätigte Muster-Einträge; bis zu 5 Entscheidungen und Sackgassen nach Wörtern und Dateien der Karte; nach der Karte geschlossene Karten dieser Phase und des Eingangs mit denselben Dateien — als Zeilen. Eine Auswahl der Entscheidungen nach Datum gibt es nicht mehr: ein frischer Eintrag über einen anderen Teil des Programms hilft dem Agenten nicht (ЗАМЕЧАНИЯ-роадмапа.md, Abschnitt З).
Entscheidungen und Sackgassen — bis zu 6 von allen gültigen nach Wörtern und Dateien der Karte: zuerst eine Übereinstimmung mit dem Fehlertext in der Karte, dann Wörter im Titel des Eintrags, dann Wörter seines Textes, dann gemeinsame Dateien; eine Vermutung steht unter einem geprüften, ein Eintrag mit `repeats` höher. Gibt es mehr Einträge, ist die letzte Zeile „Показано 5 записей из M“: den Rest sucht der Agent selbst im Board-Ordner. Deshalb helfen der Fehlertext und genaue Wörter in der Karte und im Titel des Eintrags, ihn später zu finden.
Dieselbe Auswahl nach Fehlertext statt nach Karte ist der Befehl `kermach roadmap notes "Fehlertext"`: der Agent ruft ihn auf, wenn bei der Arbeit ein Fehler auftaucht. Deshalb steht im Eintrag der wörtliche Fehlertext oder das Symptom, wie man es vor der Analyse sieht, nicht nur die Ursache.
Text: `# …` — das Thema. Darunter — der Kern in freiem Text: Ursache → was getan wurde (bei einer Sackgasse — was versucht wurde und warum es nicht ging).
Entscheidung und Sackgasse haben eine Zeile `Текст ошибки:` (die Beschriftung ist russisch: danach sucht das Programm das Symptom): wörtlich, wie das Symptom vor der Analyse zu sehen ist (Meldung, Protokollzeile, was auf dem Bildschirm steht). Gab es keinen Fehler — `Текст ошибки: —`. Ein neuer Eintrag ohne Text bekommt diese Zeile mit `—`: der Agent ersetzt den Strich.
Der Fehler ist mit derselben Ursache wieder aufgetaucht — kein neuer Eintrag: der Agent ergänzt seine Karte in `repeats` des alten, und das Symptom der Wiederholung als weitere Zeile `Текст ошибки: … (t<Nummer>)` direkt unter `# …`. Unter dem Titel, nicht am Ende: in der Auswahl sieht der Agent die ersten 400 Zeichen des Textes. Der Befehl notes liest den ganzen Text, die Stelle der Zeile ist ihm egal; `repeats` hebt den Eintrag bei gleichen Übereinstimmungen höher (t933).
Liegt die Ursache in fremdem Code — im Kopf `stack`, am Ende des Textes der Abschnitt `## Переносимый вывод` (die Überschrift ist russisch: daran findet das Programm den Abschnitt): was in einem anderen Projekt mit demselben Stack nötig sein wird, ohne Adressen, Serverpfade, Kundennamen und Schlüssel. Der Abschnitt reicht bis zum nächsten `#`/`##` oder zum Dateiende; zum Text des Eintrags für Auswahl und Ähnlichkeit gehört er nicht. Ein `stack` mit Großbuchstaben, Leerzeichen oder Kyrillisch ist ein Dateifehler. Das Zusammenführen („zusammenführen“) ergänzt den Abschnitt des Duplikats im Abschnitt des alten Eintrags, und die `stack`-Namen, die dem alten fehlen, in seinem `stack`.
Die gemeinsame Basis für alle Projekte (t844) ist der Ordner `known\` im Datenordner des Plugins (`%APPDATA%\Kermach\plugins-data\roadmap\known\`). Das Zusammenstellen des Prompts kopiert dorthin selbst eine Entscheidung oder Sackgasse mit `how: geprüft`, `stack` und dem Abschnitt „Переносимый вывод“ — als Datei `s<N>.md`: Titel, `type`, `stack`, die erste Zeile `Текст ошибки:` und der Abschnitt. Die Zeilen „<Titel> (dN):“ nach dem Zusammenführen werden nicht kopiert. Text des Eintrags, `files`, `card` und der Projektname gehen nicht in die Basis; woher der Eintrag stammt, steht in `known\state.json`.
Nicht kopiert werden: eine Vermutung, ein aufgehobener und ein abgelaufener Eintrag, ein als „falsch“ markierter, „Правило работы: …“, ein Eintrag ohne `stack` oder Abschnitt. Ein Abschnitt mit Website-Adresse, IP, E-Mail, einem Pfad mit Benutzernamen, Pfad oder Namen des Projektordners, etwas Schlüsselähnlichem — auch nicht: der Eintrag bleibt im Projekt mit einem Zeichen des Grundes, nichts wird herausgeschnitten. `s<N>.md` darf man von Hand ändern: das Programm überschreibt die Datei nicht mehr; gelöscht — es bringt sie nicht zurück. Eine Datei mit git-Konfliktmarkern wird dem Agenten nicht gegeben.
Teil 6 nach den eigenen Einträgen — bis zu 3 Einträge der Basis aus anderen Projekten: `stack` überschneidet sich mit der Zeile `Стек: Name, Name` im Abschnitt „Projektwerkzeuge“ des Steckbriefs (das Wort `Стек:` ist russisch, so sucht es das Programm) oder mit `stack` der eigenen Einträge (Versionen spielen keine Rolle), oder `Текст ошибки:` des Eintrags steht im Kartentext. Die Übersicht der Basis ist `known\known.md`, eine Zeile pro Eintrag.
Ein Muster-Eintrag geht genauso in die Basis — `s<N>.md` mit `type: Muster`, aber nur vom Menschen bestätigt (`approved:` und Fingerabdruck in approved.json), `how` braucht er nicht. Nach der Bestätigung geändert — die Kopie wird bis zur neuen Bestätigung aus der Basis entfernt. In einem anderen Projekt wird ein Muster-Eintrag nur nach `stack` gegeben, nicht nach Fehlertext, und als erster unter den Einträgen der Basis. Dem eigenen Agenten wird der Abschnitt „Переносимый вывод“ nicht gegeben — weder in Teil 5 des Prompts noch in `kermach roadmap notes` (t992): der Text des Eintrags trägt dieselbe Ursache und Behebung in den Worten dieses Projekts, genauer als die Verallgemeinerung, und der Abschnitt würde einen Teil der 400 Zeichen fressen, die der Eintrag in der Auswahl bekommt. Der Abschnitt ist für andere Projekte; der Agent sieht ihn, wenn er `d<N>.md` öffnet.

```
---
id: d3
type: Entscheidung
card: t12
files: [src/cart/delivery.ts]
date: 2026-10-12
agent: codex
how: geprüft
---
# Lieferzone
Текст ошибки: Delivery zone is undefined
Die Zone kommt aus der Stadt im Warenkorb, nicht aus dem Profil: das Profil kann leer sein.
```

Eine Vereinbarung mit dem Menschen, die später aufgehoben wurde:
```
---
id: d7
type: Vereinbarung
card:
files: []
date: 2026-10-01
agent: Mensch
until: 2026-12-31
cancelled: 2026-10-15
---
# Preise bis zum Ende des Ausverkaufs nicht anfassen
Mensch 01.10: die Preise im Katalog nicht ändern, solange der Ausverkauf läuft. 15.10 Ausverkauf beendet — aufgehoben.
```

Eine Arbeitsregel ist auch eine Vereinbarung. Der Agent legt sie als `Entscheidung` mit dem Titel „Правило работы: …“ an (diese Wörter sind russisch: danach bietet das Fenster den Knopf „zur Vereinbarung machen“ an) und schlägt sie dem Menschen vor; den Typ ändert der Mensch:

```
---
id: d8
type: Vereinbarung
card: t9
files: []
date: 2026-10-08
agent: Mensch
---
# Правило работы: Dateien mit `\` über Edit ändern, nicht über heredoc und nicht `node -e`
Ein heredoc in Git Bash und eine Zeichenkette in `node -e` verderben den Rückstrich: der Pfad `D:\app` kommt als `D:app` an, `\n` in einer JS-Zeichenkette wird zum Zeilenumbruch.
```

Eine Sackgasse in fremdem Code:
```
---
id: d9
type: Sackgasse
card: t14
files: [src/cart/hooks.php]
date: 2026-10-16
agent: claude
how: geprüft
stack: [woocommerce, woodmart@8.1]
---
# Der Warenkorb-Hook feuert im Theme nicht
Текст ошибки: woocommerce_before_cart не вызван
Ursache: woodmart ersetzt die Warenkorb-Vorlage durch seine eigene und ruft den Hook nicht auf. Versucht: der Hook in functions.php — das Theme ruft ihn nicht auf.

## Переносимый вывод
In woodmart 8.x ist die Warenkorb-Vorlage eine eigene: der WooCommerce-Hook vor dem Warenkorb wird darin nicht aufgerufen — prüfen Sie die Vorlage des Themes, bevor Sie Code an diesen Hook hängen.
```

Muster-Eintrag (t845). Das Programm erkennt einen Kandidaten: einen Eintrag, dem 2+ andere Einträge ähneln (das Zeichen „ähnlich wie dN“ oder `repeats`), oder 3+ Einträge mit demselben `Текст ошибки:`. Den Text des Muster-Eintrags schreibt der Agent nach der Karte „Muster bilden“: ein Eintrag `type: Muster`, `from` — die Nummern der Einträge, der Titel — die Regel in einer Zeile, der Text — `Правило:`, `Почему:`, `Когда не так:` (Beschriftungen auf Russisch), insgesamt höchstens 400 Zeichen. `approved` setzt der Agent nicht: bestätigt wird vom Menschen per Knopf, das Programm merkt sich sha1 des bestätigten Textes in seinem Datenordner. Der Projektpfad gehört nicht zur Bestätigung (t1018): das Umbenennen des Ordners hebt sie nicht auf, und derselbe Text des Muster-Eintrags in einem anderen Projekt ist dort sofort bestätigt. Den Text nach der Bestätigung ändern — der Muster-Eintrag wartet wieder auf den Menschen. Ein `from` mit der Nummer eines Eintrags, den es nicht gibt, ist eine Board-Anmerkung.
Der Fingerabdruck wird aus Titel, Text, „Переносимый вывод“ und `from` berechnet, ohne Kopf: der Knopf schreibt `approved:` selbst in den Kopf. Deshalb hebt eine Änderung von `files`, `stack`, `card`, `how` die Bestätigung nicht auf — die Regel ändert sich dadurch nicht.
Im Fenster, Tab „Entscheidungen, Sackgassen, Vereinbarungen“, Filter „Muster“ (t1005): ein Kandidat hat „sieht aus wie ein Muster: d77 und noch 5“ und die Knöpfe „Muster bilden“ (die Karte „Muster bilden aus d77, …“ im Eingang) und „kein Muster“ (`pattern: нет` im Kopf von d77); ein Muster-Eintrag hat „wartet auf Bestätigung“ und den Knopf „bestätigen“. Das Zeichen „ähnlich wie dN“ bekommt ein Muster-Eintrag nicht und gibt es auch nicht: „zusammenführen“ würde ihn löschen oder Text an ihn anhängen. „Zusammenführen“ (t1014): ein Muster-Eintrag wird nur mit einem Muster-Eintrag zusammengeführt, `from` des alten — beide Listen zusammen. Wurde ein Eintrag mit `from` mit einem anderen zusammengeführt, wird in `from` der Muster-Einträge seine Nummer durch die Nummer des alten ersetzt. `from` hat sich geändert — die Bestätigung ist aufgehoben, der Muster-Eintrag wartet wieder auf den Menschen.

```
---
id: d240
type: Muster
card: t250
files: []
date: 2026-10-16
agent: claude
how: geprüft
from: [d77, d97, d136]
approved:
---
# Ein verstecktes Electron-Fenster liefert das zuletzt gezeichnete Bild
Правило: in einem versteckten Fenster sehen Bildschirmfoto, Klick und Mausbewegung ein altes Bild — rufen Sie davor webContents.invalidate() auf und warten Sie auf ein Bild.
Почему: ein verstecktes Fenster zeichnet sich nicht von selbst neu.
Когда не так: das Fenster ist auf dem Bildschirm.
```

## Board-Sprache — `lang:` im Steckbrief (t1429)

Status, Arten, Feldbeschriftungen und Abschnitte des Steckbriefs kann man in einer von vier Sprachen schreiben: `ru`, `uk`, `en`, `de`.
Die Board-Sprache ist die Zeile `lang:` im Kopf von `passport.md`. Bei diesem Board:

```
---
lang: de
---
```

Keine Zeile, kein Steckbrief oder ein unbekannter Wert — das Board ist russisch. So funktionieren alle Boards, die vor t1429 angelegt wurden.
„Roadmap erstellen“ setzt `lang:` nach der Sprache des Kermach-Fensters, wenn der Agent den Steckbrief anlegt; Russisch braucht keine Zeile.

Wie das Programm liest:
- Werte im Kopf (`status`, `kind`, `human`, bei einer Phase `status` und `health`, bei einem Eintrag `type` und `how`) — in jeder der vier Sprachen. Hat der Agent auf einem deutschen Board `status: done` geschrieben, ist die Karte trotzdem „fertig“;
- Feldbeschriftungen von Karte und Phase (`Was tun:`) und Abschnittsüberschriften des Steckbriefs — auf Russisch und in der Board-Sprache. Eine Beschriftung einer anderen Sprache ist gewöhnlicher Text: die Zeile „Why: …“ in einer deutschen Karte wird nicht zum Feld „Wozu“;
- Groß- und Kleinschreibung, „ё“ und die Art des Apostrophs (`'`, `’`, `ʼ`) spielen keine Rolle.

Wie das Programm schreibt: neue Werte im Kopf und neue Beschriftungen — in der Board-Sprache. Beschriftungen, die schon in der Datei stehen, ändert es nicht.

Die Sprache ändern — „Board-Sprache“ im Fenster des Steckbriefs. Das Programm schreibt die Formatwörter in allen Dateien des Boards um.
Vor dem Schreiben — eine Sicherung: alle Dateien des Boards werden nach `.kermach\roadmap-backup-JJJJMMTT-HHMMSS\` kopiert, neben den Board-Ordner.
Würde auch nur eine Datei in der neuen Sprache anders gelesen, ändert sich die Sprache gar nicht und keine Datei wird angefasst: zum Beispiel beginnt eine Textzeile mit einem Wort, das in der neuen Sprache eine Feldbeschriftung ist. Eine Datei mit Lesefehler und eine Datei, die während der Änderung bearbeitet wurde, werden nicht angefasst, das Fenster nennt sie.

Wörter nach Sprachen:

| ru | uk | en | de |
|---|---|---|---|
| `в очереди` | `в черзі` | `queued` | `in Warteschlange` |
| `в работе` | `в роботі` | `in progress` | `in Arbeit` |
| `ждёт ответа` | `чекає відповіді` | `awaiting answer` | `wartet auf Antwort` |
| `на проверке` | `на перевірці` | `checking` | `in Prüfung` |
| `на ревью` | `на рев'ю` | `in review` | `im Review` |
| `пауза` | `пауза` | `paused` | `pausiert` |
| `готово` (Karte) | `готово` | `done` | `fertig` |
| `запланирована` | `запланована` | `planned` | `geplant` |
| `идёт` | `триває` | `running` | `läuft` |
| `готова` (Phase) | `готова` | `done` | `fertig` |
| `зелёный` | `зелений` | `green` | `grün` |
| `жёлтый` | `жовтий` | `yellow` | `gelb` |
| `красный` | `червоний` | `red` | `rot` |
| `без человека` | `без людини` | `no human` | `ohne Mensch` |
| `нужен человек` | `потрібна людина` | `human needed` | `Mensch nötig` |
| `сделать` | `зробити` | `do` | `umsetzen` |
| `ревью` | `рев'ю` | `review` | `Review` |
| `разведка` | `розвідка` | `research` | `Recherche` |
| `решение` | `рішення` | `decision` | `Entscheidung` |
| `тупик` | `глухий кут` | `dead end` | `Sackgasse` |
| `договорённость` | `домовленість` | `agreement` | `Vereinbarung` |
| `паттерн` | `патерн` | `pattern` | `Muster` |
| `заметка` | `нотатка` | `note` | `Notiz` |
| `проверено` | `перевірено` | `verified` | `geprüft` |
| `догадка` | `здогадка` | `guess` | `Vermutung` |
| `агент` | `агент` | `agent` | `Agent` |
| `программа` | `програма` | `program` | `Programm` |
| `Что сделать` | `Що зробити` | `What to do` | `Was tun` |
| `Зачем` | `Навіщо` | `Why` | `Wozu` |
| `Файлы` | `Файли` | `Files` | `Dateien` |
| `Как проверить` | `Як перевірити` | `How to check` | `Wie prüfen` |
| `Особые указания` | `Особливі вказівки` | `Special notes` | `Besondere Hinweise` |
| `Что сделано` | `Що зроблено` | `What was done` | `Was erledigt wurde` |
| `Доказательство` | `Доказ` | `Proof` | `Nachweis` |
| `Цель` | `Мета` | `Goal` | `Ziel` |
| `Признаки готовности` | `Ознаки готовності` | `Done criteria` | `Fertig-Kriterien` |
| `Транспорт и сервер` | `Транспорт і сервер` | `Transport and server` | `Transport und Server` |
| `Инструменты проекта` | `Інструменти проєкту` | `Project tools` | `Projektwerkzeuge` |
| `Команда проверки и ожидаемый итог` | `Команда перевірки й очікуваний підсумок` | `Check command and expected result` | `Prüfbefehl und erwartetes Ergebnis` |
| `Кэш после правки` | `Кеш після правки` | `Cache after an edit` | `Cache nach einer Änderung` |
| `Обрыв соединения` | `Обрив з'єднання` | `Connection loss` | `Verbindungsabbruch` |
| `Где образцы и канон` | `Де зразки й канон` | `Samples and canon` | `Muster und Kanon` |
| `Что не трогать` | `Що не чіпати` | `Do not touch` | `Nicht anfassen` |
| `Что ещё обязано быть, кроме зелёной проверки` | `Що ще має бути, крім зеленої перевірки` | `Required besides a green check` | `Pflicht außer grüner Prüfung` |
| `Журнал` | `Журнал` | `Log` | `Protokoll` |

Außerdem gelesen: `queue`, `todo`, `to do` — „in Warteschlange“; `in work`, `working` — „in Arbeit“; `waiting`, `wartet` — „wartet auf Antwort“; `reviewing` — „im Review“; `pause` — „pausiert“.
Im Programm bleiben die Werte russische Wörter: das Fenster zeigt sie in der Sprache der Oberfläche, die Befehle `kermach` und die Proben vergleichen russische Wörter.
Aufgabenvorlagen nennen ein Board-Wort mit dem Platzhalter `{доска:<russisches Wort>}`, zum Beispiel `{доска:готово}` — auf einem deutschen Board ist das `fertig`.

## Zähler — `counter.json`

```
{ "t": 18, "d": 3 }
```

`t` ist die letzte vergebene Kartennummer, `d` die letzte Nummer eines Eintrags.
Die Nummer ist im Projekt gemeinsam und wird vergeben, sobald die Karte erscheint, auch im Eingang. Beim Verschieben in eine Phase ändert sie sich nicht.

Eine neue Karte oder ein neuer Eintrag — per Befehl im Kermach-Terminal: `kermach roadmap new t "Titel"` oder `kermach roadmap new d "Kern" --card t12`. Die Nummer vergibt das Programm: zwei Agenten zugleich nehmen nicht dieselbe Nummer.
Felder der Karte — mit Flags: `--text` — „Was tun“, `--why` — „Wozu“, `--files` — „Dateien“, `--check` — „Wie prüfen“ (t1439). Die Prüfung gehört in `--check`, nicht in `--text`: sonst bleibt „Wie prüfen“ leer, und die Roadmap-Prüfung lässt die Welle nicht starten. Eine Karte in einer Phase ohne `--check` ist eine Anmerkung in der Ausgabe des Befehls.

Eine neue Karte von Hand:
1. Finde die größte Nummer — in `counter.json` und unter den Dateien `t<N>.md`.
2. Die neue Nummer ist um eins größer. Schreibe sie in `counter.json`.
3. Lege die Datei `t<Nummer>.md` an, im Kopf `id` mit derselben Nummer.

Die Nummer einer gelöschten Karte wird nicht wieder vergeben. Kein Zähler — das Programm berechnet ihn aus den Dateien.
