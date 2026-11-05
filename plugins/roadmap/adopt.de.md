# Die Aufgabe „Vorhandenen Plan verwenden" (auf Deutsch)

Übersetzung von `adopt.md` (t1602). Das ist die erste Nachricht des Tabs, in dem ein fertiger Plan des Projekts auf das Board übertragen und nicht neu erstellt wird, wenn die Fenstersprache Deutsch ist (die Knöpfe im Panel — t1603).
Die Datei wird bei jedem Klick neu gelesen: eine Änderung zeigt sich in der nächsten Aufgabe ohne Neustart des Programms.

Wo ändern. Diese Datei neben dem Plugin-Code ist der eingebaute Text: ein Programm-Update überschreibt ihn.
Ändere die Kopie im Datenordner des Plugins: `%APPDATA%\Kermach\plugins-data\roadmap\adopt.de.md`.
Gibt es die Kopie, nimmt das Programm sie. Gibt es sie nicht, nimmt es diesen eingebauten Text. Ein Programm-Update berührt die Kopie nicht.

Wie es aufgebaut ist:
- der Text vor der ersten Überschrift `## ` ist eine Erklärung für den Menschen und geht nicht in die Aufgabe;
- der Agent bekommt den Abschnitt `## Задание`, ohne die Überschriftszeile selbst;
- `{выбор}` ist Schritt 0: der Abschnitt `## Файл выбран`, wenn der Mensch eine Datei gewählt hat, sonst der Abschnitt `## Файла нет`. Die Überschriften dieser Abschnitte werden nicht übersetzt: das Programm sucht sie nach diesen Wörtern;
- `{состав:…}` ist ein Stück der Aufgabe `compose.de.md`: `как` — die Regeln des Tabs, `1`, `2`, `3`, `6` — ganze Schritte, `5.2-поля` — die Liste der Kartenfelder aus Punkt 5.2, `5.3`, `5.4` — Punkte von Schritt 5. Die gemeinsamen Schritte werden in `compose.de.md` geändert und kommen von selbst hierher;
- die Ersetzungen sind dieselben wie in `compose.de.md`, dazu `{файл}` — die gewählte Plandatei.

## Задание
Die Aufgabe „Vorhandenen Plan verwenden": übertrage den fertigen Plan dieses Projekts auf das Board, ohne ihn neu zu erstellen. Der Projektordner ist {проект}.

Eine Roadmap ist ein Board aus Textdateien im Ordner {папка}: der Steckbrief des Projekts, Phasen und Karten. Das Programm Kermach zeigt es im Panel „Roadmap" und startet die Karten für Agenten.
Wie die Dateien des Boards aufgebaut sind, steht in der Beschreibung {формат}. Lies sie vollständig, bevor du etwas vorschlägst. Muster aller Dateiarten liegen im Ordner {образцы}.

Der Plan ist schon entschieden: du verbesserst ihn nicht und erstellst keinen neuen. Die Arbeit läuft so. Schritt 0 — du findest den Plan. Schritte 1–3 — du untersuchst das Projekt und schreibst die Übersicht, die Datei {проект}\.kermach\обзор.md. Schritt 4 — du gleichst den Plan mit dem Projekt ab. Schritt 5 — du überträgst den Plan auf das Board. Schritt 6 — die Rollen in CLAUDE.md.
Die Übersicht wird auch danach gebraucht: auf sie stützen sich der Steckbrief, die Karten und die Agenten, die die Karten erledigen. Eine oberflächliche Übersicht ergibt schlechte Karten: in ihnen stehen Vermutungen statt Fakten.

{состав:как}

{выбор}

{состав:1}

{состав:2}

{состав:3}

### Schritt 4. Abgleich des Plans mit dem Projekt
Ergänze die Übersicht um zwei Abschnitte. `## Quelle des Plans` — woher der Plan stammt (Datei oder Tab), sein Datum und warum gerade er. `## Nach Plan erledigt` — was vom Plan schon erledigt ist und was das belegt.
Schreib dann in diesem Tab in fünf bis sieben Zeilen, was in der Übersicht das Wichtigste ist, und zeig drei Listen. Andere Listen und Fragen gibt es nicht.
1. Was im Plan schon erledigt ist: der Planpunkt und was ihn belegt (Datei:Zeile). Konntest du es aus den Dateien nicht belegen, frag, ob es erledigt ist.
2. Was im Plan den Projektdateien widerspricht: beide Fassungen mit Quellen, „im Plan: …", „in den Dateien: …". Ich entscheide, du wählst nicht.
3. Was dem Board fehlt und weder im Plan noch in der Übersicht steht: der Prüfbefehl und sein Ergebnis, was nicht berührt werden darf, wie viele Agenten gleichzeitig arbeiten können, ohne an das Abo-Limit zu stoßen (kleines Abo — 1–2, normales — 3, großes — bis 8; erfinde keine Tarifnamen), die offenen Fragen des Plans selbst.
Eine offene Frage des Plans ist nur, was der Plan selbst als unentschieden bezeichnet. Arbeitsdetails, über die der Plan schweigt (Dateiformat, Namen, Aufbau eines Befehls), sind keine Fragen: die entscheidet der Kartenagent.
Fragen gibt es nur zu diesen drei Listen. Was im Plan entschieden ist, besprich nicht noch einmal: welche Phasen, in welcher Reihenfolge, wie sie heißen, was wichtiger ist. Ist eine Liste leer, schreib „keine".
Eine Frage zu einer Entscheidung kommt mit Varianten: zuerst die, die du empfiehlst, und warum in einem Satz. Eine Frage zu einem Fakt hat keine empfohlene Antwort, die Varianten sind „ich weiß: …" und „ich weiß nicht". Erkläre jeden Begriff im selben Satz.
Trag die Antworten mit Datum und der Quelle „Antwort des Menschen" in die Übersicht ein. Ein Fakt mit der Antwort „ich weiß nicht" bleibt in „Nicht geklärt". Eine offene Frage des Plans, die ich nicht entschieden habe, wird in Schritt 5 zu einer Recherche-Karte.

### Schritt 5. Übertragung des Plans auf das Board
Wir erstellen das Board in Teilen: erst den Steckbrief und alle Phasen, dann die Karten, Phase für Phase. Jeder Teil geht nach meinem „ja" sofort in Dateien.
Warum so: die Arbeit ist lang, und unterwegs komprimiert der Tab seinen Kontext, sodass Einzelheiten des Gesprächs verloren gehen. Was schon in Dateien liegt, geht nicht verloren.
Stütz dich auf den Plan und die Übersicht, nicht auf allgemeines Wissen über solche Projekte. Namen, Kopfzeilen, Abschnitte und der Zähler der Dateinummern — streng nach {формат}.

Ändere und lösche die Plandatei nicht.
Ergänze nur, was nicht im Plan steht. In dem, was du mir zeigst, hat jede Zeile eine Markierung: „aus dem Plan" oder „von mir ergänzt". In den Dateien des Boards markiere nur Ergänztes: „(von mir ergänzt)" am Ende eines Ziels oder Kriteriums der Phase; bei einer Karte die Zeile „Von mir ergänzt: <welche Felder>" in „Besondere Hinweise" und `source: aus dem Plan` im Kopf. Bei einer Karte, die der Plan nicht hat: `source: von mir ergänzt` und „Von mir ergänzt: die ganze Karte".
Schreib Abkürzungen und Nummern aus dem Plan (zum Beispiel „Frage 79") mit Wörtern aus der Datei aus, in der sie beschrieben sind: ein Kartenagent sieht diese Datei nicht und versteht die Nummer nicht. Lass eine Nummer nur so stehen: „Wörter, was das für eine Frage ist (Frage 79)" oder „Frage 79: Wörter, was das für eine Frage ist". Genauso bei einer Nummer aus der Übersicht und bei „offene Frage des Plans Nr. 3", im Titel und im Text einer Karte, in einer Karte und in einem Eintrag. Sonst entferne die Nummer: im Satz „die Antwort zu Frage 60" erklärt sie nichts, egal wie viele Wörter daneben stehen. Hast du nicht gefunden, was sie bedeutet, frag mich.

5.1. Steckbrief und Phasen.
   Zeig als Text in diesem Tab eine Tabelle „im Plan → auf dem Board", den Steckbrief und alle Phasen, ohne Karten.
   Jede Etappe des Plans ist eine Phase: der Name Wort für Wort wie im Plan und dieselbe Reihenfolge. Führe Etappen nicht zusammen, stelle sie nicht um und füge ohne mein „ja" keine neuen hinzu. Die Regel „zwei bis fünf Phasen" gilt hier nicht: es gibt so viele Phasen wie im Plan.
   Nimm Ziel und Fertig-Kriterien der Phase aus dem, was der Plan für diese Etappe verspricht. Was fehlt, ergänze und markiere. Zwei bis fünf Kriterien, jedes wird durch einen äußeren Fakt geprüft: Befehl, Seite, Datei. Setze für Phasen keine Gesundheit.
   Der Steckbrief hat neun Abschnitte nach {формат}. Der Abschnitt „Prüfbefehl und erwartetes Ergebnis" — aus dem Abschnitt „Prüfung" der Übersicht: Befehl, Ergebnis und was zu tun ist, wenn schon ein Lauf geht. Kein Befehl — schreib das so, die erste Karte der ersten Phase legt ihn an. Die erste Zeile des Abschnitts „Projektwerkzeuge" ist `Стек: Name, Name` (das Wort `Стек:` genau so, auf Russisch), in lateinischen Kleinbuchstaben. Verweise im Steckbrief auf die Übersicht und die Projektdateien, statt sie nachzuerzählen.
   Warte auf mein „ja". Nach „ja" lege in {папка} an: passport.md, f<N>.md für jede Phase, counter.json. Phasen bekommen `status: geplant`, die erste — `läuft`. Lege jede geltende Vereinbarung aus der Übersicht als Eintrag d<N>.md mit `type: Vereinbarung` an.

5.2. Karten — Phase für Phase, in der Reihenfolge der Phasen. Zeig die Karten einer Phase, warte auf „ja" oder Änderungen, lege sie nach „ja" als Dateien t<N>.md an und nimm die nächste Phase.
   Hat der Plan Aufgaben, wird jede Aufgabe zu einer vollen Karte, in derselben Reihenfolge und mit denselben Worten. Ergänze nur fehlende Felder. Aufgaben teilen oder zusammenlegen nur nach meinem „ja".
   Hat der Plan keine Aufgaben, nur Etappen, bekommt jede Phase Entwürfe (Abschnitt „Kartenentwurf" in {формат}): `draft: да` im Kopf (das Wort `да` auf Russisch: das Programm liest es), Titel, „Was tun", „Wozu", „Dateien"; „Wie prüfen" — ein Strich. Entwürfe auch in der ersten Phase: volle Karten schreibst du nur auf mein Wort, Phase für Phase. Biete sie nicht von dir aus an und beginne sie nicht. Sag in der Zusammenfassung von 5.4, dass eine Welle keine Entwürfe startet und dass die erste Phase mein Wort braucht. Auf so einem Board verspricht Schritt 6 keinen Start der ersten Phase: volle Karten schreibt die Hauptsitzung auf mein Wort und startet die Phase erst danach.
   Was im Plan Menschen, Zugänge und Entscheidungen betrifft, wird zu Karten `human: Mensch nötig`, in der Phase, die sie braucht (bei einem Plan ohne Aufgaben ebenfalls Entwürfe). Was genau vom Menschen nötig ist, kommt in „Besondere Hinweise", Schritt für Schritt. So eine Karte hat `source: aus dem Plan`, auch wenn du die Schritte für den Menschen ergänzt hast: das Ergänzte markiert die Zeile „Von mir ergänzt: …". Die Phasen hängen von ihnen ab: Karten dieser Phase, die das vor dem Start brauchen, haben solche Karten in `depends`.
   Jeder solche Punkt ist eine eigene Karte, auch in einem eigenen Abschnitt des Plans. Punkte zusammenlegen nur nach meinem „ja". Geh vor 5.3 diese Abschnitte des Plans Zeile für Zeile durch und nenne jeden Punkt ohne Karte. Legst du dafür eine Karte an, trag sie in `depends` des Reviews dieser Phase ein.
   Offene Fragen des Plans, die ich in Schritt 4 nicht entschieden habe, werden zu Karten `kind: Recherche`. Nach Plan Erledigtes kommt nur in die Übersicht, dafür gibt es keine Karten.
   Eine Reihenfolge aus dem Plan („5 und 6 parallel, 7 danach") wird zu `depends`-Verbindungen zwischen Karten der Phasen: die Phasennummern laufen fortlaufend, und ein eigenes Abhängigkeitsfeld hat eine Phase nicht. Die erste Karte der ersten Phase hängt von nichts ab außer von Karten „Mensch nötig".
   Kartenfelder:
{состав:5.2-поля}
   Die letzte Karte jeder Phase ist ein Review (Abschnitt „Phasen-Review-Karte" in {формат}): `kind: Review`, `depends` — alle übrigen Karten der Phase, „Wie prüfen" — jedes Fertig-Kriterium der Phase: ja oder nein und was es belegt. „Dateien" eines vollen Reviews ist das, was es liest, mit den Worten „nur lesen"; einen Strich wertet die Board-Prüfung als Fehler. In einer Phase aus Entwürfen ist das Review auch ein Entwurf, „Wie prüfen" — ein Strich.
   Jede Karte, voll oder Entwurf, hat außerdem Agent, Modell, Aufwand und Berater — nach der Auswahlregel aus dem Abschnitt „Karte" der Beschreibung, und den Grund in einer Zeile (die Schlüssel `agent`, `model`, `effort`, `advisor`, `agent_why`). Alle Karten haben `status: in Warteschlange`.
   Bevor du die Karten einer Phase zeigst, prüf sie selbst: keine Karte ohne Verbindung zu einem Fertig-Kriterium, kein Kriterium ohne Karte, die letzte Karte ist ein Review, keine Vereinbarung aus der Übersicht, die eine Karte verletzt, keine Nummer aus dem Plan ohne Worte daneben.

{состав:5.3}
   Ein Plan ohne Aufgaben: die Karten im „Eingang" sind ebenfalls Entwürfe, `draft: да`, „Wie prüfen" — ein Strich.
   Löse Nummern aus dem Plan und der Übersicht auch hier auf, im Kartentitel und im Text: nicht „Frage 99", sondern was das für eine Frage ist, aus der Datei, in der sie beschrieben ist. Prüf das vor dem Zeigen in jeder Karte im „Eingang".
   Ein Planpunkt zu Menschen, Zugängen und Entscheidungen hat `source: aus dem Plan`, steht in der Phase, die ihn braucht, und deren Karten warten in `depends` auf ihn. In den „Eingang" kommt er nur, wenn ihn keine Phase braucht, ebenfalls mit `source: aus dem Plan`. Nenne mir so einen Punkt in einer eigenen Zeile: „Keine Phase braucht ihn: tN — warum".

{состав:5.4}
   Such vor der Zusammenfassung mit Grep im Board-Ordner nach den Wörtern „Frage", „вопрос", „питання" und den Zeichen „Nr." und „№" mit einer Zahl daneben. An jeder Stelle muss in Worten stehen, worum es bei der Frage geht. So nicht: „der Mensch beantwortet Frage 95", „Wozu: offene Frage 1 des Plans", „Antwort des Menschen (Frage 94)". Schreib es nach der Datei um, in der die Frage beschrieben ist, oder entferne die Nummer.
   Führ vor der Zusammenfassung im Projektordner den Befehl `kermach roadmap check` aus. Er prüft das Board ohne KI. Findet er Fehler, behebe sie und führ ihn erneut aus. Lief der Befehl nicht, sag das in der Zusammenfassung.
   Beginne die Nachricht mit dieser Zusammenfassung mit einer eigenen Zeile, wörtlich: „Maßgeblich ist jetzt das Board. Die Plandatei blieb, wie sie war, und wird nicht mehr geführt."

{состав:6}

## Файл выбран
### Schritt 0. Der Plan ist die gewählte Datei
Ich habe die Plandatei gewählt: {файл}
Den Plan musst du nicht suchen: beginne mit dieser Datei und lies sie. Eine große Datei lies in Teilen, wie oben gesagt.
Sieh nach, was sie über andere Pläne und über sich selbst sagt: „ersetzt", „bleibt eine Aufzeichnung des Erledigten", „veraltet", „ersetzt durch …", in jeder Sprache.
- Ist die Datei selbst durch eine andere ersetzt, warne mich: wodurch und in welcher Zeile das steht. Frag, ob die gewählte Datei genommen werden soll, und beende die Nachricht mit der Zeile „Jetzt: Schritt 0 von 6, von dir nötig: …". Ohne Antwort geh nicht weiter.
- Ist sie nicht ersetzt, frag nichts und geh zu Schritt 1. Was sie über andere Pläne sagt, schreibst du in Schritt 4 in die Übersicht.

## Файла нет
### Schritt 0. Finde den Plan
Der Plan liegt in einer Datei oder im Gespräch eines anderen Tabs. Suche in dieser Reihenfolge und überspringe nichts: ein Dateiname täuscht oft, ein alter PLAN.md kann neben einem neuen Plan unter anderem Namen liegen.
1. Journale und Verzeichnisse des Projekts: SESSION-now.md, ИНДЕКС.md, ІНДЕКС.md, CLAUDE.md. Oft nennen sie den geltenden Plan direkt.
2. Dateinamen: roadmap*, роадмап*, plan*, план*, фаз*, этап*, етап*, phase*, ohne Beachtung der Groß- und Kleinschreibung, im ganzen Projektordner, nicht nur im Stamm. Große Ordner (node_modules, .git, Builds, Archive, Datenbank-Exporte) nicht durchlaufen.
3. Überschriften in .md- und .txt-Dateien: „Фаза N", „Этап N", „Етап N", „Phase N". Dieselben großen Ordner nicht durchlaufen.
4. Tabs dieses Projekts: `kermach sessions` zeigt die Tabs aller Projekte, nimm nur die, bei denen das Projekt dieser Ordner ist. Lies ein Gesprächsjournal in Teilen, zuerst per Suche nach den Wörtern „Phase", „Etappe", „Plan", nicht vollständig.

Lies beim Gefundenen den Anfang und was es über andere Pläne sagt: „ersetzt", „bleibt eine Aufzeichnung des Erledigten", „veraltet". So sieht man, welcher Plan gilt.
Zeig das Gefundene als Liste: Datei oder Tab, Datum, wie viele Etappen. Dann deine Wahl und den Grund, zum Beispiel: „Ist er das? Er ersetzt PLAN.md, das steht an seinem Anfang". Beende den Zug mit dieser Frage.
- Gibt es mehrere Pläne oder widersprechen sie sich, zeig alle, ich wähle. Führe sie nicht selbst zusammen.
- Hast du nichts gefunden, bitte mich, eine Datei oder einen Tab zu nennen oder den Plantext in den Chat einzufügen. Füge ich Text ein, schreib ihn in die Übersicht und nimm als Quelle „Text aus dem Chat", lege dafür keine anderen Dateien an.
Beende die Nachricht mit der Zeile „Jetzt: Schritt 0 von 6, von dir nötig: …". Solange ich den Plan nicht bestätigt habe, geh nicht zu Schritt 1.
