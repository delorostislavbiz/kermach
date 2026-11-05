# Aufgabe „Neue Karte" (Deutsch)

Übersetzung von `newcard.md` (t1428). Das ist die erste Nachricht des Claude-Tabs, den die Schaltfläche „Neue Karte" im Panel „Roadmap" öffnet, wenn das Board schon existiert und deutsch ist (`lang: de` im Steckbrief).
Die Datei wird bei jedem Klick neu gelesen: eine Änderung erscheint in der nächsten Aufgabe ohne Neustart des Programms.

Wo ändern. Diese Datei neben dem Plugin-Code ist der eingebaute Text: ein Programm-Update überschreibt ihn.
Ändern Sie die Kopie im Datenordner des Plugins: `%APPDATA%\Kermach\plugins-data\roadmap\newcard.de.md`.
Gibt es die Kopie, nimmt das Programm sie. Sonst nimmt es diesen eingebauten Text. Ein Programm-Update fasst die Kopie nicht an.

Aufbau:
- Text vor der ersten Überschrift `## ` ist eine Erklärung für den Menschen, er geht nicht in die Aufgabe;
- alles nach der Zeile der ersten Überschrift `## ` geht an den Agenten, die Überschriftzeile selbst nicht; die Überschrift ist dieselbe wie in `newcard.md`;
- Platzhalter: `{проект}` — Projektordner, `{папка}` — Board-Ordner, `{формат}` — die Datei FORMAT.de.md mit der Beschreibung des Boards, `{язык}` — Sprache des Boards.

Der Agent fragt zuerst, was zu tun ist, untersucht dann das Projekt zum Thema und legt die Karte erst nach „ja" an.
Eine Karte, die auf Vermutungen beruht, bearbeiten die Agenten später nach Vermutungen. Darum hat jede Tatsache in der Karte eine Quelle.

## Задание
Hilf, eine neue Karte auf dem Roadmap-Board dieses Projekts anzulegen. Der Projektordner ist {проект}.
Das Board sind Textdateien im Ordner {папка}: Steckbrief, Phasen und Karten. Wie die Dateien aufgebaut sind — Beschreibung {формат}. Lies den Abschnitt „Karte", bevor du die Karte schreibst.

Untersuche das Projekt selbst, starte keine Subagenten: weder im Hintergrund noch normale. Diese Aufgabe hebt die allgemeine Regel „Großes an einen Subagenten" aus deinen Anweisungen auf. Warum: die Meldung, dass ein Hintergrund-Subagent fertig ist, erreicht diesen Tab oft nicht, und er steht stundenlang still.
Beende einen Zug nicht mit „ich warte", „ich mache weiter, wenn…", „ich warte auf den Bericht": danach weckt dich niemand. Ein Zug endet entweder mit einer Frage an mich oder mit einem fertigen Schritt.
Schreib mir in der Sprache: {язык} — sowohl die Fragen als auch den Kartentext.

Die Arbeit läuft so.
1. Frag mich mit einer Frage, was zu tun ist. Bis zur Antwort nichts lesen und nichts tun.
2. Nach der Antwort untersuche das Projekt zu diesem Thema:
   - die Projektübersicht `{проект}\.kermach\обзор.md`, falls vorhanden — ganz, bis zur letzten Zeile;
   - den Steckbrief `passport.md` und alle Phasen `f<N>.md` — Ziele und Fertig-Kriterien: danach wählst du die Phase;
   - alle Karten `t<N>.md`, auch fertige — ob es dieselbe oder eine ähnliche Aufgabe gibt; Einträge `d<N>.md` zum Thema und alle Vereinbarungen (`type: Vereinbarung`), außer aufgehobenen und abgelaufenen;
   - Projektdateien zum Thema: finde, wo es im Code oder in Dokumenten steht, und lies diese Stellen. Übersicht, Steckbrief oder eine Karte verweist auf eine Datei — öffne sie, urteile nicht nach dem Namen.
3. Schlage die Karte als Text vor, die Datei noch nicht anlegen:
   - Titel — was sich nach der Karte ändert, in einfachen Worten, ohne Namen aus dem Code (Titelregel — Abschnitt „Karte" in {формат});
   - Phase — Nummer und warum; keine Phase passt oder du bist unsicher — „Eingang";
   - Art: `umsetzen`, `Review` oder `Recherche` (klären, ohne etwas zu ändern);
   - was zu tun ist, wozu, Dateien (Pfade, wo nötig mit Zeilen), besondere Hinweise (was nicht anfassen, Rückgängig), falls vorhanden;
   - wie prüfen — eins von drei: ein Befehl und das erwartete Ergebnis; ohne Befehl — was womit abgleichen (Datei:Zeile, Kanon aus dem Steckbrief); prüfen kann nur ein Mensch oder es braucht einen Zugang, den der Agent nicht hat — schreib es so;
   - ob ein Mensch nötig ist, von welchen Karten sie abhängt;
   - Agent, Modell, Aufwand und Berater — nach der Auswahlregel aus dem Abschnitt „Karte" der Beschreibung {формат}, und der Grund in einer Zeile.
   Jede Tatsache in der Karte hat eine Quelle: Datei und Zeile. Was du nicht gefunden hast — schreib es so in die Karte, rate nicht.
   Eine ähnliche Karte gibt es schon — nenne ihre Nummer und ihren Titel und sag, worin sich die Aufgaben unterscheiden. Schlage vor: in sie ergänzen oder eine neue anlegen. Zuerst — die Option, die du empfiehlst, und warum.
   Frag am Ende: keine ähnliche Karte — „Anlegen?"; es gibt eine — „In tNN ergänzen oder eine neue anlegen?". Ein „ja" ohne Wahl ist deine empfohlene Option.
4. Nach meinem „ja" lege die Karte mit dem Befehl `kermach roadmap new t "Titel"` an, für eine Phase — mit `--phase fN`. Der Befehl gibt die Nummer aus und legt die Datei an. Sagt er „похоже на tNN" (ähnelt tNN) — öffne tNN und sag mir, ob es dieselbe Aufgabe ist.
   Dann ergänze die Datei nach der Board-Beschreibung: im Kopf `status: in Warteschlange`, `kind`, `agent` (`claude`, wenn ich keinen anderen Ausführenden genannt habe), `model`, `effort`, `advisor` (nur `да` — auf Russisch, das Programm liest dieses Wort; sonst kein Schlüssel), `agent_why`, `pick: человек` (nur wenn ich Modell oder Aufwand genannt habe; der Wert bleibt russisch, das Programm liest ihn), `depends`, `human`, `created` — die Zeit mit dem Befehl `date`, `source: mit einem Menschen erstellt`; im Text — die Felder in der Reihenfolge der Beschreibung, „Was erledigt wurde: —" und „Nachweis: —".
   Kein kermach-Befehl (das Terminal ist nicht Kermach) — die Nummer ist die nächste nach der größten in counter.json und unter den Dateien `t<N>.md`; trage sie auch in counter.json ein. Eine Karte im „Eingang" ist ein leeres Feld `phase:`, nicht das Wort „Eingang".
   Um eine Korrektur gebeten — korrigiere und frag noch einmal. Die Option „in die ähnliche ergänzen" wurde gewählt — ergänze dort, was du vorgeschlagen hast, lege keine neue an; am Ende — ihre Nummer und ihr Pfad.
5. Am Ende in einer Zeile: Kartennummer und Dateipfad. Sonst nichts auf dem Board und im Projekt ändern.
