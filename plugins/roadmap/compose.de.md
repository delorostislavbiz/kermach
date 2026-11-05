# Aufgabe „Roadmap erstellen" (Deutsch)

Übersetzung von `compose.md` (t1428). Das ist die erste Nachricht des Claude-Tabs, den die Schaltfläche „Roadmap erstellen" auf dem leeren Panel „Roadmap" öffnet, wenn die Fenstersprache Deutsch ist (t519).
Die Datei wird bei jedem Klick neu gelesen: eine Änderung ist in der nächsten Aufgabe ohne Neustart des Programms sichtbar.

Wo ändern. Diese Datei neben dem Plugin-Code ist der eingebaute Text: ein Programm-Update überschreibt ihn.
Ändern muss man die Kopie im Datenordner des Plugins: `%APPDATA%\Kermach\plugins-data\roadmap\compose.de.md`.
Es gibt eine Kopie — das Programm nimmt sie. Keine Kopie — es nimmt diesen eingebauten Text. Ein Programm-Update fasst die Kopie nicht an.

Aufbau:
- Text vor der ersten Überschrift `## ` ist eine Erklärung für den Menschen, er geht nicht in die Aufgabe;
- alles nach der Zeile der ersten Überschrift `## ` geht an den Agenten, die Überschriftzeile selbst nicht. Die Überschrift `## Задание` ist dieselbe russische Zeile wie in `compose.md`: an ihr findet das Programm die Aufgabe;
- Platzhalter: `{проект}` — Projektordner, `{папка}` — Board-Ordner, `{формат}` — die Datei FORMAT.de.md mit der Beschreibung des Boards, `{образцы}` — der Ordner mit Musterdateien des Boards (samples.de), `{язык}` — die Sprache des Boards.

Zuerst untersucht der Agent das Projekt und schreibt die Übersicht — die Datei `.kermach\обзор.md` im Projektordner (t805). Auf die Übersicht stützen sich später Steckbrief, Karten und Kartenagenten.
Am Ende fügt der Ersteller die Rollen aus der Vorlage `project-claude.de.md` in die `CLAUDE.md` des Projekts ein — sie liegt neben dieser Datei (Schritt 6, t1326).
Als Letztes öffnet er mit dem Befehl `kermach roadmap start` den Tab der Hauptsitzung und übergibt ihr das Ergebnis des Abgleichs (t1423).
Vor der Hauptsitzung liest ein frischer Prüfer das Board (t1438): höchstens zwei Runden, ernste Anmerkungen korrigiert der Ersteller.
Fragen nach Projektart sind die Abschnitte `### Art: …`. Jeder lässt sich einzeln ändern. Eine eigene Art — ein neuer Abschnitt `### Art: <Name>` daneben, in derselben Zeilenordnung: eine Frage pro Zeile.

## Задание
Hilf mir, eine Roadmap für dieses Projekt zu erstellen. Der Projektordner ist {проект}.

Eine Roadmap ist ein Board aus Textdateien im Ordner {папка}: Projektsteckbrief, Phasen und Karten. Das Programm Kermach zeigt es im Panel „Roadmap" und startet die Karten mit Agenten.
Wie die Board-Dateien aufgebaut sind — die Beschreibung {формат}. Lies sie vollständig, bevor du etwas vorschlägst. Muster aller Dateiarten — im Ordner {образцы}.

Die Arbeit läuft so. Zuerst untersuchst du das Projekt und schreibst die Übersicht — die Datei {проект}\.kermach\обзор.md. Dann stellst du mir Fragen zu dem, was nicht in den Dateien steht. Dann erstellen wir gemeinsam das Board und die Rollen in CLAUDE.md.
Die Übersicht wird auch danach gebraucht: auf sie stützen sich Steckbrief, Karten und die Agenten, die die Karten machen. Eine oberflächliche Übersicht ergibt schlechte Karten: darin stehen Vermutungen statt Fakten.

### Wie in diesem Tab arbeiten
- Schreib mir in der Sprache: {язык} — Fragen, Übersicht, Text des Boards und der Karten. Der Dateiname der Übersicht `обзор.md` bleibt, wie er ist: das Programm sucht ihn.
- Untersuche das Projekt selbst, starte keine Subagenten: weder im Hintergrund noch normale. Diese Aufgabe hebt die allgemeine Regel „Großes — an einen Subagenten" aus deinen Anweisungen auf.
  Warum: die Meldung über das Ende eines Hintergrund-Subagenten erreicht diesen Tab oft nicht, und er steht stundenlang; und die Auszüge der Subagenten musst du ohnehin selbst lesen, und der Kontext wird mehrmals verdichtet.
- Großes in Teilen lesen, nicht ganz. Eine Datei bis ~500 Zeilen — ganz. Ein Protokoll oder eine Datei über ~500 Zeilen (SESSION.md, PLAN.md, Notizen) — zuerst ihre Überschriften (Zeilen, die mit `#` beginnen), dann die letzten ~300 Zeilen, dann Suche nach den Themen von Schritt 1: Zugang, Vereinbarungen, Verbote, was kaputt ging.
- Lege das Gerüst der Übersicht sofort an, vor Schritt 1: die Datei {проект}\.kermach\обзор.md mit allen Abschnitten von Schritt 3, vorerst leer. Ergänze sie im Lauf jedes Schritts — die Datei wächst, während du arbeitest.
- Beende einen Zug nicht mit den Worten „ich warte", „ich mache weiter, wenn…", „ich warte auf den Bericht": danach weckt dich niemand. Ein Zug endet entweder mit einer Frage an mich oder mit einem fertigen Schritt.
- In den Schritten 4–6 endet jede Nachricht an mich mit einer Zeile: „Jetzt: Schritt N von 6, von dir nötig: …" — was genau von mir nötig ist. So sieht man, dass der Zug mit einer Frage endete und nicht stehen blieb.

Was eine gute Roadmap ist — behalte das ab dem ersten Schritt im Kopf:
- Jede Karte macht später ein eigener Agent in einem neuen Tab. Er sieht dieses Gespräch nicht: er hat nur den Kartentext, den Steckbrief und die Übersicht. Was nicht in der Karte steht, weiß der Agent nicht.
- Eine Karte ist ein Durchgang eines Agenten: ein prüfbares Ziel, meist bis zu drei Dateien zum Ändern. Mehr — auf mehrere Karten mit der Verbindung `depends` aufteilen.
- „Fertig" bei Karte und Phase ist eine äußere Tatsache: Befehlsausgabe, Datei und Zeile, Screenshot einer Seite. Nicht „der Agent hat gesagt, dass er es gemacht hat".
- Eine Phase ist abgeschlossen, wenn ihre Fertig-Kriterien erfüllt sind, nicht wenn die Karten ausgehen.

### Schritt 1. Gedächtnis des Projekts — immer, vor dem Code
Lies, was über das Projekt schon aufgeschrieben ist. Das ist das Erste, was zu tun ist, in jedem Projekt.
- Regeln und Protokolle im Projektordner: CLAUDE.md, AGENTS.md, Dateien in .claude\, SESSION.md, SESSION-now.md, PLAN*.md, README, Notizen zum Stand und zu Aufgaben.
- Gedächtnis von Claude Code: der Ordner ~\.claude\projects\<Schlüssel>\memory\, zuerst MEMORY.md. Der Schlüssel ist der volle Projektpfad, in dem jedes Zeichen außer lateinischen Buchstaben und Ziffern durch „-" ersetzt ist: D:\Work\my_shop → D--Work-my-shop. Ordner mit Kyrillisch im Namen haben gleiche Schlüssel — prüfe an MEMORY.md, dass das Gedächtnis zu diesem Projekt gehört.
- Frühere Gespräche, wenn es den Befehl mempalace gibt. `mempalace status` — die Liste der Flügel; finde den Flügel des Projekts in dieser Liste, meist ist es der Ordnername in Kleinbuchstaben. Dann `mempalace search "Frage" --wing <Flügel>` — mehrere Anfragen nach Themen: wie das Projekt aufgebaut ist, Zugang, Vereinbarungen, was verboten ist, was kaputt ging und warum.
- Das frühere Board, falls vorhanden: Dateien d<N>.md in {папка} — Entscheidungen, Sackgassen, Vereinbarungen und Regel-Muster. Ein Regel-Muster (`type: Muster`, in alten Dateien `паттерн`) ist eine Regel, gesammelt aus den Einträgen in seinem `from`. Ein Regel-Muster mit `approved:` hat der Mensch bestätigt: es geht als Projektregel in die Übersicht, statt der Einträge aus `from`.
Schreib gesondert die Vereinbarungen mit dem Menschen und mit seinem Kunden heraus: was entschieden, was verboten, was verschoben wurde, wie üblicherweise gearbeitet wird. Bei jeder — Datum und wo es steht.

### Schritt 2. Projektart
Bestimme anhand der Dateien, was für ein Projekt das ist. Es kann mehrere Arten zugleich geben: Website und Marketing, Programm und Dokumentation. Beantworte für jede Art ihre Fragen unten.
Die Art fehlt in der Liste — stelle die Fragen selbst nach demselben Schema auf und nenne die Art in der Übersicht.
Ein Muster des Ergebnisses — in jeder Projektart. Ein Muster ist das, dem das Ergebnis ähneln soll: Layout, Mockup, Design, alte Website, ein fremder Text „mach es genauso".
Suche es in den Dateien und in den Vereinbarungen (Ordner html, Layout, design, Mockups, Links zu Figma, ein Export der alten Website). Gefunden — zähle für jede Seite des Musters seine Abschnitte von oben nach unten auf, bis zum Seitenende, nicht nach dem ersten Bildschirm.
Markiere bei jedem Abschnitt, ob es im Projekt Daten dafür gibt: Texte, Fotos, Preise, Bewertungen. Wo keine Daten sind — das ist eine Frage an den Menschen in Schritt 4, kein Abschnitt, den man stillschweigend auslassen kann.

### Art: Website
- Worauf sie gebaut ist: die Engine und ihre Version, PHP, Datenbank, Hosting und Webserver.
- Theme: Eltern- und Kind-Theme, ihre Versionen. Page Builder (Bricks, Elementor, Gutenberg-Blöcke) und seine Erweiterungen.
- Womit Abschnitte und Seiten gemacht sind: Theme-Vorlagen, Vorlagen und Komponenten des Builders, Blöcke, ACF-Felder, eigene Stile. Wo ihre lokalen Kopien oder Exporte liegen.
- Plugins — als Liste mit Versionen und dem Datum, für das die Versionen stimmen. Welche bezahlt oder lizenziert sind, welche deaktiviert, welche aktualisiert wurden und was danach kaputt ging.
- Eigener Code: functions.php des Kind-Themes, mu-plugins, Snippets (Code Snippets, Fluent Snippets, WPCode), eigenes CSS und JS in den Builder-Einstellungen. Wo die lokalen Kopien liegen und wie frisch sie sind.
- Zugang: SSH, REST API, WP-CLI oder nur das Admin-Panel. Was die Projektregeln erlauben und verbieten, worüber Änderungen auf den Server gehen.
- Wie eine Änderung geprüft wird: welche Seiten, welcher Cache zu leeren ist, ob es Staging gibt.
- Einen Export oder eine entpackte Kopie der Website gefunden (Backup, .wpress, zip) — sieh dir ihre Ordner zwei Ebenen tief an. Dort liegt oft der frischeste Code: Themes, Plugins, Snippets. Vergleiche die Daten mit anderen Kopien.
Geh nicht auf den Server und nicht ins Netz: kläre all das aus Dateien und Gedächtnis, und was darin fehlt — schreib in „Nicht geklärt".

### Art: Programm
- Sprache und ihre Version, Paketmanager, wichtigste Bibliotheken.
- Wie bauen, starten und prüfen: Befehle aus README, package.json, Makefile, CI.
- Hauptteile und ihre Verbindungen: welche Ordner, wo der Einstiegspunkt ist, was wovon abhängt.
- Tests: gibt es welche, wie werden sie gestartet, was prüfen sie.
- Was jetzt kaputt oder unfertig ist: TODO, offene Aufgaben, Protokoll.

### Art: Texte und Marketing
- Für wen: Leser oder Käufer, Auftraggeber und seine Aufgabe.
- Ton und Stimme: Stilregeln, Verbote, Beispiele für gelungenen und misslungenen Text.
- Fertige Materialien und Muster: was schon geschrieben ist, was als Muster gilt.
- Änderungen des Kunden: was er geändert hat und warum, welche Anmerkungen sich wiederholen.
- Wo veröffentlicht wird: Plattformen, Formate, Länge, Fristen.
- Was funktioniert hat und was nicht: Zahlen, Rückmeldungen, Schlüsse aus früheren Arbeiten.

### Art: Recherche
- Welche Frage: was zu klären ist und wozu.
- Quellen: was schon gesammelt ist, wo es liegt, welchen man trauen kann.
- Was schon geklärt ist und was offen bleibt.

### Schritt 3. Übersicht — die Datei {проект}\.kermach\обзор.md
Abschnitte der Übersicht:
- `# Projektübersicht` und das Datum darunter;
- `## Projektart` — welche Arten und an welchen Dateien das zu sehen ist;
- `## Was ich gelesen habe` — die Liste der Gedächtnisquellen und wichtigsten Dateien;
- je ein Abschnitt pro Art, zum Beispiel `## Website` — Antworten auf die Fragen der Art;
- `## Vereinbarungen` — mit Datum und Quelle bei jeder;
- `## Prüfung` — womit eine Änderung geprüft wird: ein Befehl und sein erwartetes Ergebnis (zum Beispiel „13 von 13"), wo er beschrieben ist, ob zwei Läufe gleichzeitig gehen können. Kein Befehl — schreib es so und beschreibe, wie von Hand geprüft wird;
- `## Muster` — wo das Muster liegt und was als Übereinstimmung gilt; je Seite — die Abschnitte von oben nach unten und ob es für jeden Daten gibt. Kein Muster — schreib es so;
- `## Begonnen und kaputt` — offene Aufgaben, TODO, unfertige Pläne, bekannte Fehler, mit Quelle. Daraus wachsen später Karten;
- `## Nicht geklärt` — Frage und Grund: nicht in den Dateien, Zugang nötig, Quellen widersprechen sich.
Jede Tatsache hat eine Quelle in Klammern: Datei:Zeile, ein Befehl (`mempalace search "…"`) oder eine Gedächtnisdatei. Eine Tatsache ohne Quelle nicht schreiben.
Quellen widersprechen sich — gib beide mit Datum an, die neuere zuerst. Nimm Fakten aus den Dateien, nicht aus Vermutungen nach dem Ordner- oder Dateinamen.
Lies Verzeichnisse, Listen und Dateiköpfe, nicht nur Überschriften. Große Ordner (node_modules, Builds, Archive, Videos, Datenbank-Exporte) nicht ganz durchgehen: sieh dir darin ein Verzeichnis oder ein paar Dateien an.
Passwörter, Schlüssel und Tokens nicht in die Übersicht schreiben, auch wenn du sie siehst — nur, wo sie liegen. Auch keine Namen von Menschen: „der Mensch", „der Kunde", „der Werbespezialist".

### Schritt 4. Fragen an mich
Wenn die Übersicht geschrieben ist, schreib in diesem Tab in fünf bis sieben Zeilen, was darin das Wichtigste ist.
Dann sammle die Fragen — nur zu den Lücken aus „Nicht geklärt" und zu dem, ohne das sich Steckbrief und Phasen nicht erstellen lassen. Frag nicht, was schon in der Übersicht steht.
Kläre unbedingt, wenn es nicht in der Übersicht steht: welches Ergebnis des Projekts der Mensch in den nächsten Wochen braucht; was am wichtigsten ist; was nicht angefasst wird; mit welchem Befehl oder welcher Handlung eine Änderung geprüft wird.
Es gibt ein Muster — zwei Entscheidungsfragen sind Pflicht, vor den Karten:
- „Ist fertig eine Übereinstimmung mit dem Muster über die ganze Seite?" Die empfohlene Antwort ist ja: sonst messen die Prüfungen „die Seite öffnet ohne Fehler", und fehlende Abschnitte sieht niemand bis zum Ende der Arbeit.
- Abschnitte des Musters ohne Daten — einzeln oder als eine Liste „Seite: Abschnitt": „Text und Bilder aus dem Muster nehmen", „Abschnitt entfernen", „die Daten schicke ich". Empfohlen ist der Text aus dem Muster: die Seite bleibt vollständig, der Mensch ersetzt den Text später.
Einen solchen Abschnitt nicht stillschweigend auslassen und nicht in die Liste „entscheidet der Eigentümer" verschieben: die Antwort ändert die Karten. Schreib die Antwort in die Übersicht, Abschnitt „Muster", und in die Karten dieser Seiten.
Frag auch, wie viele Agenten gleichzeitig arbeiten können, ohne an das Abo-Limit zu stoßen: ein kleines Abo — 1–2, ein normales — 3, ein großes — bis 8. Tarifnamen nicht erfinden. Die Antwort wird in 5.4 gebraucht.

Fragen gibt es in zwei Arten, und sie werden unterschiedlich gestellt.
- Entscheidungen — was wählen: was wichtiger ist, was zuerst, was nicht anfassen. Zu jeder — Antwortvarianten, zuerst die, die du empfiehlst, und warum in einem Satz.
- Fakten — wie es wirklich ist: ob es eine Kopie der Website zum Ausprobieren gibt, welche PHP-Version, welcher Zugang zum Server, welches Abo. Die Antwort kennt nur der Mensch, deine Antwort wäre eine Vermutung. Darum hat eine Tatsache keine empfohlene Antwort. Es gibt immer zwei Varianten: „ich weiß: …" und „ich weiß nicht".
Schreib so, dass ein Mensch es versteht, der das zum ersten Mal macht. Erkläre jeden Fachbegriff im selben Satz: nicht „gibt es Staging?", sondern „gibt es Staging — eine Kopie der Website, auf der man Änderungen ausprobieren kann, ohne die echte anzufassen?". Bittest du, etwas zu finden oder zu tun — Schritt für Schritt: wo öffnen, was klicken, was schicken.

Sammle zuerst alle Fragen, dann stelle sie in einer Nachricht: „Fragen: N", darunter zwei Gruppen — „Entscheidungen" und „Fakten", in jeder die Themen der Fragen, je eine Zeile, und am Ende „Besprechen wir jede der Reihe nach, oder bist du mit den empfohlenen Antworten einverstanden?".
- „Empfohlene" — gib alle Fragen als eine Liste aus: Nummer, Frage, bei einer Entscheidung — die empfohlene Antwort und warum in einem Satz, bei einer Tatsache — „ich weiß: … / ich weiß nicht" ohne empfohlene. Warte auf Bestätigung.
  Der Mensch kann einzelne Nummern korrigieren („alles ja, außer 3: …") — nimm die Korrektur an, zeige nur die korrigierten Punkte erneut und warte auf „ja". Bittet er, einzelne Nummern zu besprechen — geh sie einzeln durch.
  Eine Tatsache, auf die der Mensch nicht selbst geantwortet, sondern sie mit der Liste oder „ja" angenommen hat, ist „ich weiß nicht".
- „Besprechen" — stelle eine Frage nach der anderen und warte auf die Antwort.
Aus einer Antwort ist eine neue Frage entstanden — stelle sie gesondert, in derselben Ordnung.

Ergänze die Antworten in der Übersicht mit Datum. Quelle: „Antwort des Menschen" — wenn der Mensch selbst geantwortet oder korrigiert hat; „Antwort des Menschen: Empfehlung angenommen" — wenn er der Liste zugestimmt hat.
Eine Tatsache mit der Antwort „ich weiß nicht" bleibt in „Nicht geklärt". In 5.2 wächst daraus eine Recherche-Karte oder ein Punkt einer Karte „Mensch nötig".
Ohne eine Annahme lässt sich das Board nicht erstellen — schreib sie in die Übersicht mit der Quelle „Vermutung, ohne Prüfung angenommen (Liste TT.MM)". Ein solcher Punkt kommt in das Ergebnis von 5.4 „was auf einer Vermutung beruht".

### Schritt 5. Das Board
Wir erstellen das Board in Teilen: zuerst den Steckbrief und alle Phasen, dann die Karten — eine Phase nach der anderen. Jeder Teil geht nach meinem „ja" sofort in Dateien.
Warum so: die Arbeit ist lang, und unterwegs verdichtet der Tab seinen Kontext — Details des Gesprächs gehen verloren. Was schon in Dateien liegt, geht nicht verloren.
Stütze dich auf die Übersicht, nicht auf allgemeines Wissen über solche Projekte. Namen, Köpfe, Abschnitte und der Zähler der Dateinummern — streng nach {формат}.
Wörter des Board-Formats — Status, Kartenarten, Feld- und Abschnittsnamen — schreib auf Deutsch, wie in {формат} und den Mustern {образцы}. Beginne den Steckbrief mit einem Kopf mit der Zeile `lang: de` (zwischen Zeilen `---`): danach schreibt das Programm die Board-Wörter auf Deutsch. Schreibst du sie nicht, ergänzt das Programm sie selbst, wenn es den Steckbrief sieht.

5.1. Steckbrief und Phasen.
   Schlage in diesem Tab als Text den Steckbrief und alle Phasen vor, ohne Karten.
   Der Steckbrief hat neun Abschnitte nach {формат}. Der Abschnitt „Prüfbefehl und erwartetes Ergebnis" — aus dem Abschnitt „Prüfung" der Übersicht: Befehl, Ergebnis, und was zu tun ist, wenn schon ein Lauf geht (keinen zweiten starten, abwarten oder fragen). Kein Prüfbefehl — die erste Karte der ersten Phase legt ihn an.
   Die erste Zeile des Abschnitts „Projektwerkzeuge" ist `Стек: Name, Name` (das Wort `Стек:` genau so, auf Russisch: das Programm sucht danach): Themes, Plugins, Frameworks und Bibliotheken, die eigene Fehler haben, in lateinischen Kleinbuchstaben, wie das Feld `stack` der Einträge (`Стек: woocommerce, woodmart`). Danach bekommt der Kartenagent geprüfte Lösungen aus anderen Projekten mit demselben Stack. Verweise im Steckbrief auf die Übersicht und die Projektdateien, statt sie nachzuerzählen.
   Phasen — zwei bis fünf, der Reihe nach. Eine Phase hat ein Ziel in einem Satz — was sich für den Menschen oder seinen Kunden ändert, nicht „Code schreiben". Fertig-Kriterien — zwei bis fünf, jedes wird durch eine äußere Tatsache geprüft: einen Befehl, eine Seite, eine Datei. Setze den Phasen keinen Gesundheitszustand: den setzen der Mensch und die Prüfung im Lauf der Arbeit.
   Es gibt ein Muster — die erste Phase endet mit einem Pilot: eine Seite vollständig und ihr Abgleich mit dem Muster über die ganze Seite, von oben nach unten, nicht nach dem ersten Bildschirm. Die erste und jede folgende Phase, die Seiten ändert, hat das Kriterium „die Seiten der Phase stimmen mit dem Muster überein: jeder Abschnitt ist da oder nach der Antwort des Menschen entfernt". Schieb den Abgleich mit dem Muster nicht in die letzte Phase: dort sieht ihn niemand mehr rechtzeitig.
   Warte auf mein „ja". Ich kann korrigieren — dann zeige das Korrigierte und warte erneut.
   Nach „ja" lege in {папка} an: passport.md, f<N>.md für jede Phase, counter.json. Phasen bekommen `status: geplant`, die erste — `läuft`. Lege jede geltende Vereinbarung aus der Übersicht als Eintrag d<N>.md mit `type: Vereinbarung` an (Schlüssel — nach {формат}): der Agent jeder Karte bekommt sie.

5.2. Karten — eine Phase nach der anderen, in der Reihenfolge der Phasen.
   Zeige die Karten einer Phase, warte auf „ja" oder Änderungen, lege sie nach „ja" als Dateien t<N>.md an und nimm die nächste Phase. So bis zur letzten.
   Die erste Phase — volle Karten. Jede ist eine Aufgabe für einen Agenten, der dieses Gespräch nicht gesehen hat:
   - Titel — was sich ändert, in einfachen Worten, ohne Namen aus dem Code (Abschnitt „Karte" der Beschreibung);
   - „Was tun" — konkret, mit der Stelle im Projekt; nennt die Übersicht Datei und Zeile — nenne sie;
   - „Wozu" — welches Fertig-Kriterium der Phase die Karte voranbringt;
   - „Dateien" — welche Dateien geändert werden dürfen; was nicht angefasst werden darf — in „Besondere Hinweise";
   - „Wie prüfen" — Punkt für Punkt, jeder Punkt eine äußere Tatsache und das erwartete Ergebnis. Die Prüfung misst das Ziel der Karte, nicht nur das Fehlen von Fehlern: das Ziel „wie im Muster" — ein Abgleich mit dem Muster über die ganze Seite (Abschnitte von oben nach unten: wie viele im Muster, wie viele auf der Seite, ein Screenshot der ganzen Seite). „Öffnet ohne Fehler", „ohne fatal", „ein H1" ist für eine solche Karte zu wenig: der Prüfer gibt sie zurück;
   - `depends` — Nummern der Karten, ohne die diese nicht beginnen kann. Die erste Karte einer Phase hängt von nichts ab. Reihenfolge der Karten — von der, die die übrigen öffnet, zu der, die dem Ziel der Phase näher ist. Eine Karte kann auch von einer Karte einer früheren Phase abhängen;
   - `kind` — `Recherche`, wenn zuerst etwas zu klären ist (Ursache, Zugang, Zustand), `Review` für die Prüfung fremder Arbeit, sonst `umsetzen`;
   - `human: Mensch nötig`, wenn die Karte ohne den Menschen nicht zu machen ist: Zugang, Entscheidung, Bezahlung, Prod. Was genau vom Menschen nötig ist — in „Besondere Hinweise", Schritt für Schritt, wie für jemanden, der das zum ersten Mal macht: wo öffnen, was klicken, was schicken. Erkläre jeden Fachbegriff im selben Satz;
   - die Karte arbeitet mit einem Server, einer Website oder einem Dienst — sie hat `depends` auf die Karte, die den Zugang dazu gibt. Ohne eine solche Verbindung — nur, wenn der Zugang schon in der Übersicht steht;
   Die folgenden Phasen sind Entwürfe (Abschnitt „Kartenentwurf" in {формат}): `draft: да` im Kopf (das Wort `да` auf Russisch: das Programm liest es), Titel, „Was tun", „Wozu", „Dateien"; „Wie prüfen" — ein Strich. Wir ergänzen sie beim Abgleich nach der vorigen Phase, nach dem, was wir in der Arbeit erfahren. Eine Welle startet keine Entwürfe.
   Die letzte Karte jeder Phase ist ein Review (Abschnitt „Phasen-Review-Karte" in {формат}): `kind: Review`, `depends` — alle übrigen Karten der Phase, „Wie prüfen" — jedes Fertig-Kriterium der Phase: ja oder nein und womit bewiesen. In einer Entwurfsphase ist das Review auch ein Entwurf.
   Jede Karte, voll oder Entwurf, hat außerdem Agent, Modell, Aufwand und Berater — nach der Auswahlregel aus dem Abschnitt „Karte" der Beschreibung, und den Grund in einer Zeile. In der Kartendatei sind das die Schlüssel `agent`, `model`, `effort`, `advisor`, `agent_why`; habe ich Modell oder Aufwand genannt — noch `pick: человек` (genau so, auf Russisch: das Programm liest dieses Wort).
   Alle Karten — `status: in Warteschlange`, im Feld `source` — `mit dem Menschen erstellt`.
   Bevor du die Karten einer Phase zeigst, gleiche sie selbst ab: eine volle Karte hat „Was tun", „Dateien", „Wie prüfen" ausgefüllt, ein Entwurf — „Was tun", „Wozu", „Dateien"; es gibt keine Karte ohne Verbindung zu einem Fertig-Kriterium; kein Fertig-Kriterium ohne Karte; die letzte Karte ist ein Review; keine Vereinbarung aus der Übersicht, die eine Karte verletzt; eine Karte mit dem Ziel „wie im Muster" gleicht in „Wie prüfen" die ganze Seite mit dem Muster ab; Abschnitte ohne Daten sind nach der Antwort aus Schritt 4 entschieden; eine Karte, die mit einem Server, einer Website oder einem Dienst arbeitet, hat `depends` auf die Zugangskarte, oder der Zugang steht in der Übersicht. Eine Abweichung gefunden — korrigiere sie vor dem Zeigen.

5.3. „Eingang".
   Begonnenes und Kaputtes aus der Übersicht, das zum Ziel keiner Phase führt — Karten im „Eingang" (leeres Feld `phase`), nicht in Phasen.
   Kandidaten für ein Regel-Muster — je 3 und mehr Einträge des früheren Boards zu einer Ursache, gezählt vom Programm: {паттерны}
   Schlage für jeden Kandidaten eine Karte im „Eingang" „Regel-Muster aus dN, dN, … sammeln" der Art `umsetzen` vor, die Nummern — aus der Zeile des Kandidaten. Das Regel-Muster selbst nicht schreiben und `approved:` nicht setzen: das Regel-Muster schreibt der Agent dieser Karte, bestätigen wird es der Mensch.
   Die Zeile eines Kandidaten hat „überschneidet sich" — frag mich, ob ein gemeinsames Regel-Muster oder zwei gesammelt werden. Die Antwort „eins" — eine Karte mit den Nummern beider Zeilen, „zwei" — eine Karte pro Zeile.
   Zeigen, auf „ja" warten, als Dateien anlegen.

5.4. Gesamtabgleich.
   Prüfe das ganze Board anhand der Dateien: jedes Fertig-Kriterium jeder Phase hat eine Karte; Abhängigkeiten zwischen den Phasen sind angegeben; Karten mit Server, Website oder Dienst haben eine Verbindung zur Zugangskarte; die letzte Karte jeder Phase ist ein Review; keine Karte verletzt Vereinbarungen; es gibt ein Muster — der Abgleich damit steht im Pilot und in den Kriterien jeder Phase mit Seiten, nicht nur in der letzten. Eine Abweichung gefunden — zeige sie und korrigiere nach „ja".
   Das Ergebnis in einer Zeile: wie viele Phasen, wie viele volle Karten in der ersten Phase, wie viele Entwürfe, wie viele im „Eingang", und was auf dem Board auf einer Vermutung beruht statt auf einer Tatsache aus der Übersicht. Hierher auch — jeder Punkt der Übersicht mit der Quelle „Vermutung, ohne Prüfung angenommen".
   Dann bitte mich, das Agentenlimit nach der Antwort aus Schritt 4 zu setzen, Schritt für Schritt: das Panel „Roadmap" öffnen; die Zeile „Sitzungen gleichzeitig: … belegt von" finden — sie erscheint, wenn das Board Phasen hat; eine Zahl in der Liste rechts wählen. Selbst kannst du es nicht setzen: dafür gibt es keinen Befehl. Das Limit gilt für das ganze Programm, für alle Projekte zugleich. Die Antwort zum Abo ist „ich weiß nicht" — sag, dass im Programm standardmäßig 3 eingestellt ist, und schlag vor, mit 2 zu beginnen.

### Schritt 6. Projektregeln — CLAUDE.md
In diesem Ordner arbeiten die Hauptsitzung (mit mir) und die Kartenagenten, und alle lesen die CLAUDE.md des Projekts. Schreib die Rollen hinein.
Der Rollentext ist die Datei `project-claude.de.md` im selben Ordner wie {формат}: alles ab der ersten Zeile `## ` bis zum Ende, wie es ist, ohne Nacherzählung.
- Es gibt keine CLAUDE.md — zeige den ganzen Text der neuen Datei.
- Es gibt sie, ohne den Abschnitt `## Wer du bist` und ohne `## Кто ты` — hänge den Text ans Ende an, den Rest nicht anfassen.
- Es gibt sie mit `## Wer du bist` oder mit `## Кто ты` (die russische Einfügung aus `project-claude.md`) — das ist eine frühere Einfügung: ersetze sie (von dieser Überschrift bis zur ersten `## `, die nicht aus der Vorlage ist, oder bis zum Ende), hänge keine zweite an.
- In CLAUDE.md oder AGENTS.md widersprechen eigene Regeln zu Rollen der Vorlage — zeige sie und frag, was bleibt.
Zeige den Diff (`+` und `-`), schreib nach meinem „ja", mit den Zeilenenden der Datei. Das Ergebnis in einer Zeile: angelegt, angehängt oder ersetzt, wie viele Zeilen.

Wenn die CLAUDE.md geschrieben ist, prüft ein frischer Agent das Board, und dann öffnet sich die Hauptsitzung — ab da führt sie die Arbeit, nicht ich von Hand:
1. Führe `kermach roadmap start --summary "Ergebnis"` aus. Statt „Ergebnis" — das Ergebnis des Gesamtabgleichs aus Schritt 5.4: wie viele Phasen und Karten, was auf einer Vermutung beruht, die Punkte der Übersicht „Vermutung, ohne Prüfung angenommen", was von mir nötig ist. Nicht länger als 4000 Zeichen, in einer Zeile, ohne doppelte Anführungszeichen darin.
2. Zuerst prüft der Befehl das Board mit dem Programm. Hat er Fehler gefunden — antwortet er mit ihrer Liste: korrigiere die Karten und führe den Befehl erneut aus.
3. Dann liest ein frischer Prüfer das Board — ein eigener claude, der dieses Gespräch nicht gesehen hat und Dateien nur liest. Der Befehl antwortet «проверка роадмапа идёт» (Roadmap-Prüfung läuft) mit Code 4 — das ist kein Fehler.
   Schreib mir in einer Zeile, dass ein frischer Agent das Board prüft, und beende den Zug mit der Zeile „Jetzt: Schritt 6 von 6, von dir nötig: nichts — die Roadmap-Prüfung läuft; gibt es länger als 25 Minuten keine Ergebniszeile — schreib „weiter"".
   Ich habe „weiter" geschrieben — führe denselben Befehl erneut aus: eine abgebrochene Prüfung beginnt das Programm neu, eine fertige zeigt es.
   Hier darfst du den Zug beenden und warten — das ist eine Ausnahme von der Regel zu „ich warte": das Ergebnis druckt das Programm selbst in diesen Tab als Zeile «[Роадмап] Проверка роадмапа, круг N из 2: …» (Roadmap-Prüfung, Runde N von 2). Warte nicht in einer Schleife und mit `sleep`: die Zeile kommt als eigene Nachricht.
4. Eine Zeile mit ernsten Anmerkungen ist gekommen — lies die Auswertungsdatei, der Pfad steht in der Zeile, und korrigiere die Anmerkungen in den Board-Dateien. Ändert die Korrektur nichts Vereinbartes (Ziel einer Karte, Zusammensetzung der Phasen) — korrigiere selbst, ohne mein „ja". Ist eine neue Karte, eine neue Phase oder ein anderes Ziel nötig — zeige es mir und warte auf „ja".
   Korrigiert — führe `kermach roadmap start --summary "Ergebnis"` erneut aus: die zweite Runde beginnt. Höchstens zwei Runden. Was nach der zweiten bleibt — schreib es in das Ergebnis für mich, als eigene Zeile „Nach der Prüfung offen: …".
   Kleine Anmerkungen aus der Auswertung schreib auch in das Ergebnis — entscheiden werde ich.
5. Der Befehl hat den Tab der Hauptsitzung geöffnet — schreib mir „Alles fertig:" und in einer Zeile, was angelegt ist: Übersicht, Steckbrief, wie viele Phasen und Karten, CLAUDE.md, was die Prüfung gesagt hat.
   Die Hauptsitzung liest das Board, sagt mir, was nötig ist, und startet die erste Phase selbst.
6. Als letzte Nachricht schreib: „Meine Arbeit ist beendet. Weiter geht die Arbeit im Tab „Hauptsitzung"". Diesen Tab nicht schließen: ich schließe ihn.
Der Befehl antwortete, dass der Tab der Hauptsitzung schon offen ist — schreib es so, mit seiner Nummer. Er antwortete mit einem anderen Fehler — schreib ihn wörtlich und was ich tun soll: ein Terminal im Projektordner öffnen und `kermach roadmap start` ausführen.

Lege nur an, was im Gezeigten und Vereinbarten war: Neues — zuerst zeigen. Schreib keine Namen von Menschen in die Board-Dateien, auch wenn du sie aus Einstellungen oder anderen Dateien kennst: das Board führen auch andere Menschen.
Bis zu meinem „ja" zu Steckbrief und Phasen nichts im Ordner {папка} anlegen. Die einzige Datei, die du früher schreibst, ist die Übersicht {проект}\.kermach\обзор.md. Andere Projektdateien nicht ändern: diese Arbeit betrifft nur Übersicht, Board und Rollen in CLAUDE.md (Schritt 6, nach meinem „ja" zum Diff).
Jeder angelegte Teil erscheint sofort im Panel „Roadmap".
