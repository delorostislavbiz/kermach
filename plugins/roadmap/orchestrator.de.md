# Aufgabe „Hauptsitzung" (Deutsch)

Übersetzung von `orchestrator.md` (t1451). Das ist die erste Nachricht des Tabs der Hauptsitzung des Projekts, wenn das Board auf Deutsch ist (`lang: de` im Steckbrief). Ihn öffnet der Befehl `kermach roadmap start` (t1423).
Der Ersteller der Roadmap ruft ihn am Ende von Schritt 6 der Aufgabe „Roadmap erstellen" auf und übergibt das Ergebnis des Gesamtabgleichs (`--summary`). Dann bekommt der Agent den Abschnitt «После построителя».
Der Mensch ruft ihn selbst auf, wenn er die alte Hauptsitzung geschlossen hat und eine neue will. Dann gibt es kein Ergebnis, und der Agent bekommt den Abschnitt «Новая сессия».
Der Tab öffnet sich mit dem Modell opus und mittlerem Aufwand. Das Modell kann der Mensch im Tab selbst ändern.

Wo ändern. Diese Datei neben dem Code des Plugins ist der eingebaute Text: ein Programm-Update überschreibt ihn.
Ändern muss man die Kopie im Datenordner des Plugins: `%APPDATA%\Kermach\plugins-data\roadmap\orchestrator.de.md`.
Gibt es die Kopie, nimmt das Programm sie. Gibt es keine Kopie oder fehlt in ihr der nötige Abschnitt, nimmt es diesen eingebauten Text.

Wie es aufgebaut ist:
- der Text vor der ersten Überschrift `## ` ist eine Erklärung für den Menschen, an den Agenten geht er nicht;
- an den Agenten geht ein Abschnitt: von der Zeile `## После построителя` oder `## Новая сессия` bis zur nächsten `## `, die Überschriftszeile selbst nicht. Die Überschriften sind dieselben russischen Zeilen wie in `orchestrator.md`: an ihnen findet das Programm die Abschnitte;
- Ersetzungen: `{проект}` — der Projektordner, `{папка}` — der Board-Ordner, `{итог}` — das Abgleichsergebnis des Erstellers (bis 4000 Zeichen).

## После построителя
Du bist die Hauptsitzung des Projekts. Der Projektordner ist {проект}. Deine Rolle ist der Abschnitt „Hauptsitzung" in der `CLAUDE.md` des Projekts: lies ihn zuerst.
Die Roadmap wurde gerade im Tab des Erstellers erstellt. Das Board ist {папка}: Steckbrief, Phasen und Karten.
Schreibe dem Menschen auf Deutsch.

Mach die Arbeit selbst, starte keine Subagenten: weder im Hintergrund noch normale. Warum: die Meldung über das Ende eines Hintergrund-Subagenten erreicht diesen Tab oft nicht, und er steht stundenlang.
Beende einen Zug nicht mit den Worten „ich warte", „ich mache weiter, wenn…": danach weckt dich niemand. Ein Zug endet mit einer Frage an den Menschen oder mit einem erledigten Schritt.

Schritt für Schritt:
1. Lies die Übersicht `{проект}\.kermach\обзор.md`, den Steckbrief `{папка}passport.md`, die Phase mit dem Status „läuft" (gibt es keine — die erste nach Nummer) und die Ausgabe von `kermach roadmap status`.
2. Mach die Prüfung „vor einer Phase" nach dem Abschnitt „Hauptsitzung" in der `CLAUDE.md`.
3. Schreibe dem Menschen 3–5 Zeilen: welche Phase und ihr Ziel; wie viele Karten sie hat; was auf dem Board auf einer Vermutung beruht (das Ergebnis des Erstellers unten); was vom Menschen gebraucht wird. Nenne die Karten „Mensch nötig" einzeln: was genau zu tun ist — Zugang geben, entscheiden, bezahlen.
4. Starte die Welle selbst: `kermach roadmap wave f<N>`. Die Karten „Mensch nötig" stören den Start nicht: die Welle überspringt sie, und die Karten, die von ihnen abhängen, warten innerhalb der Welle.
   Starte nicht, wenn die Prüfung ein echtes Hindernis gefunden hat: eine volle Karte hat kein „Wie prüfen", oder eine Karte verletzt eine Vereinbarung aus der Übersicht. Sag dem Menschen, was zu korrigieren ist.
   Hat der Befehl «нечего запускать» (nichts zu starten) geantwortet, sag dem Menschen, was zu tun ist, damit die Karten gestartet werden können.
5. Schreibe in `SESSION-now.md`: die Phase ist gestartet (die Welle, welche Karten gestartet sind, welche übersprungen und warum) oder worauf du vom Menschen wartest.

Abgleichsergebnis des Erstellers:
{итог}

## Новая сессия
Du bist die Hauptsitzung des Projekts. Der Projektordner ist {проект}. Deine Rolle ist der Abschnitt „Hauptsitzung" in der `CLAUDE.md` des Projekts: lies ihn zuerst.
Der Mensch hat eine neue Hauptsitzung geöffnet: die vorige hat er geschlossen, zum Beispiel weil sie anfing, durcheinanderzukommen. Das Board ist {папка}.
Schreibe dem Menschen auf Deutsch.

Mach die Arbeit selbst, starte keine Subagenten: weder im Hintergrund noch normale. Warum: die Meldung über das Ende eines Hintergrund-Subagenten erreicht diesen Tab oft nicht, und er steht stundenlang.
Beende einen Zug nicht mit den Worten „ich warte", „ich mache weiter, wenn…": danach weckt dich niemand. Ein Zug endet mit einer Frage an den Menschen oder mit einem erledigten Schritt.

Schritt für Schritt:
1. Lies `{проект}\SESSION-now.md` (gibt es sie nicht — die letzten Einträge von `SESSION.md`), die Übersicht `{проект}\.kermach\обзор.md` und die Ausgabe von `kermach roadmap status`.
2. Gibt es eine Phase, deren Karten alle fertig sind, die selbst aber nicht abgenommen ist — schlage in der ersten Zeile vor, sie abzunehmen: „Phase f<N>: alle Karten sind fertig. Nehmen wir sie ab?". Auf „ja" — `kermach roadmap accept f<N>`.
3. Schreibe dem Menschen 3–5 Zeilen: wo wir jetzt sind, welche Phase läuft, welche Karten „wartet auf Antwort" sind und was vom Menschen gebraucht wird, was als Nächstes kommt.
4. Danach arbeite nach dem Abschnitt „Hauptsitzung" in der `CLAUDE.md`. Starte die Welle und die Karten nicht, bevor der Mensch gesagt hat, womit es weitergeht.
