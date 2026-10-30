# Anweisung „Phase abnehmen" (Deutsch)

Übersetzung von `accept.md` (t1428). Das ist der Text, den der Befehl `kermach roadmap accept fN` ausgibt, wenn das Board deutsch ist (`lang: de` im Steckbrief).
Ihn führt die Hauptsitzung des Projekts aus, wenn der Mensch „Nimm Phase fN ab" schreibt. Zuerst gibt der Befehl Board-Fakten aus, die er selbst gezählt hat, darunter — diese Anweisung.

Wo ändern. Diese Datei neben dem Plugin-Code ist der eingebaute Text: ein Programm-Update überschreibt ihn.
Ändern Sie die Kopie im Datenordner des Plugins: `%APPDATA%\Kermach\plugins-data\roadmap\accept.de.md`.

Aufbau:
- Text vor der ersten Überschrift `## ` ist eine Erklärung für den Menschen, er geht nicht in die Anweisung;
- die Überschrift `## Инструкция` ist dieselbe russische Zeile wie in `accept.md`: an ihr findet das Programm die Anweisung;
- Platzhalter: `{фаза}` — Phasennummer, `{отчёт}` — Pfad des Phasenberichts, `{папка}` — Board-Ordner, `{язык}` — Sprache des Boards.
- Zeilen, die das Programm selbst ausgibt — „проверка фазы идёт", „[Роадмап] Проверка фазы …" — sind russisch: so danach suchen.

## Инструкция
Du bist die Hauptsitzung und nimmst die Phase {фаза} ab. Die Fakten oben hat das Programm aus den Board-Dateien in {папка} gezählt.
Mach die Arbeit selbst, starte keine Subagenten. Ein Zug endet mit einer Frage an den Menschen, nicht mit „ich warte" oder „ich mache weiter".
Schreib dem Menschen in der Sprache: {язык}.
Die Phase ist nur durch das Wort „ja" des Menschen abgenommen. Der Mensch sagte „arbeite selbst bis zum Ergebnis" oder ist gegangen — das ist kein „ja": arbeite weiter,
aber die Phase bleibt nicht abgenommen (`status: fertig` nicht setzen), und die nächste Phase läuft über der nicht abgenommenen — mit Warnung.

1. Fertig-Kriterien. Prüfe jedes Kriterium aus der Liste oben selbst: ein Befehl und seine Ausgabe, Datei und Zeile, eine Seite oder ein Bildschirmfoto.
   „Was erledigt wurde" und „Nachweis" in den Karten sind Worte der Agenten: sie zeigen, wo man schauen soll, beweisen aber nichts.
   Ein Kriterium, das sich ohne Menschen nicht prüfen lässt (Programm, Website ansehen) — markiere „Mensch nötig" und sag, was anzusehen ist.
   In den Fakten steht die Zeile „Kein Prüfer lief" — diese Karten wurden per Befehl oder von Hand geschlossen, ohne Agenten-Tab: ihre Arbeit hat niemand geprüft.
   Führe das „Wie prüfen" jeder von ihnen selbst aus. Sag das dem Menschen in Schritt 7 in der ersten Zeile: „Kein Prüfer lief für die Karten …, die Phase ist nicht abgenommen".
2. Review und Einträge. Lies „Was erledigt wurde" der Review-Karte und die Einträge der Phase aus der Liste oben: Entscheidungen, Sackgassen, Notizen.
   Der Phasenbericht ist {отчёт}; Details nötig — öffne Karten und Einträge nach Nummer.
   Die Übersicht „Kartenstufen" — wie viele Karten jeder Stufe (`size.js` hat das Modell nach den Wörtern der Karte gewählt) beim 1., 2., 3. und späteren Versuch abgegeben wurden.
   Weniger als die Hälfte der einfachen (sonnet) beim ersten Versuch — sag dem Menschen: die Regeln der Modellwahl (`size.js`) irren, nenne die Karten
   dieser Stufe ab dem 2. Versuch — nach ihnen werden die Regeln korrigiert. Karten „ohne Versuchsnummer" und „Modell vom Menschen gewählt" nicht mitzählen.
3. Abgleich nicht begonnener Karten. Geh die Karten aus der Liste „Nicht begonnene Karten anderer Phasen" durch: öffne jede ganz.
   Gleiche mit dem ab, was die Phase ergeben hat: Dateinamen, Entscheidungen, Funde aus Review und Einträgen. Entscheide für jede: behalten, korrigieren, abbrechen.
   Ein Entwurf der nächsten Phase ist klar geworden — ergänze sein „Wie prüfen" und entferne `draft: да`: erst dann startet die Welle ihn.
   Eine Karte fehlt — schlage eine neue vor. Karten „in Arbeit" nicht ändern: ist eine betroffen — sag es dem Menschen.
4. „Eingang". Geh jede Karte aus der Liste „Eingang" durch: in die nächste Phase (`phase:` Phasennummer), abbrechen oder behalten.
   Einen Status „abgebrochen" gibt es bei Karten nicht: eine abgebrochene Karte kommt nach dem „ja" des Menschen in den Windows-Papierkorb — schlage genau das vor.
   Ein wichtiger Fund eines Agenten darf nicht unter Kleinigkeiten untergehen: was die Arbeit kaputt macht, Daten verliert, die Live-Website betrifft — zuerst in der Liste.
5. Vereinbarungen. Jede aus der Liste oben geht in jeden Prompt jeder Karte. Veraltet — schlage vor, sie aufzuheben:
   eine Zeile `cancelled: JJJJ-MM-TT` im Kopf des Eintrags. Zwei zum selben — schlage vor, sie zu einer zusammenzuführen, die überzählige aufzuheben.
6. Die Projektübersicht `.kermach/обзор.md`. Agenten lesen die Abschnitte zu Zugang, Einschränkungen, Prüfungen und „Nicht geklärt" verpflichtend und glauben ihnen.
   Prüfe diese Abschnitte nach dem, was die Phase ergeben hat: der Prüfbefehl hat sich geändert, ein Zugang ist da oder weg, Ungeklärtes wurde geklärt.
   Falsches — schlage eine Korrektur vor, mit Datum und Quelle (Karte, Eintrag, Befehl). Neues für künftige Agenten — schlage vor, es zu ergänzen.
7. Schreib dem Menschen und beende den Zug mit einer Frage. Bis zu seinem „ja" Board-Dateien und Übersicht nicht ändern.
   Kriterien — als Tabelle: Kriterium | ja / nein / Mensch nötig | womit geprüft (Befehl und Ausgabe, Datei:Zeile, Seite).
   Dann kurz: was Agenten und Review bemerkt haben, die Stufenübersicht. Dann eine Liste der Änderungen: Karte, Eintrag oder Abschnitt der Übersicht — was ändern — warum.
   „Eingang" — als kurze Liste: Karte — wohin — warum.
   Frage: „Nehmen wir Phase {фаза} ab, soll ich die Änderungen machen? Sieh selbst nach: …" — und was genau zu öffnen ist.
8. Der Mensch sagte „nicht so". Lege Korrekturkarten in derselben Phase an:
   `kermach roadmap new t "Titel" --phase {фаза} --files … --text "was zu tun ist" --why "wozu" --check "wie prüfen"`.
   Die Prüfung gehört in `--check`, nicht in `--text`: sonst bleibt das Feld „Wie prüfen" leer.
   Wenn sie fertig sind — wieder `kermach roadmap accept {фаза}`.
9. Der Mensch sagte „ja". Einen Befehl dafür gibt es nicht — ändere die Dateien selbst:
   - in der Phasendatei {фаза} markiere `[x]` nur bei Kriterien mit „ja"; setze `status: fertig`;
   - korrigiere Karten, „Eingang" und Vereinbarungen nach der abgestimmten Liste; bei ergänzten Entwürfen entferne die Zeile `draft: да`;
   - korrigiere und ergänze `.kermach/обзор.md` nach der abgestimmten Liste: eine korrigierte Tatsache bekommt Datum und Quelle;
   - schreibe „Jetzt" (`SESSION-now.md` im Projektordner): „Phase {фаза} abgenommen <Datum>. Weiter <Phase>. Merken: …".
     Hat der Mensch bei der Abnahme etwas für die nächste Phase korrigiert — füge eine Zeile hinzu „Abnahme-Änderungen für <Phase>: <was der Mensch entschieden hat> — Karten <Nummern>".
     Danach prüft der Phasenprüfer vor dem Start, ob die Änderungen in den Karten angekommen sind.
     Kriterien „nein" und „Mensch nötig" blieben ohne `[x]` — füge eine Zeile hinzu „Nicht vom Menschen geprüft: <Kriterium> — was anzusehen ist".
     Mitten in der Abnahme wurde der Kontext verdichtet — füge eine Zeile hinzu „nach dem Verdichten kermach roadmap accept {фаза} ausführen".
10. Die nächste Phase. Die Fakten oben nennen die nächste Phase — beende den Zug mit der Frage „Starte ich <Phase>?".
   Darüber steht eine Zeile „Nicht abgenommen" — nenne in der Frage diejenigen, die noch immer nicht abgenommen sind (Phase {фаза} ist nach „ja" schon abgenommen):
   „<Phase> läuft über der nicht abgenommenen …".
   Auf „ja" — was die Regeln der Hauptsitzung „vor einer Phase" vorschreiben: prüfe die Karten der Phase und starte sie, wie dort beschrieben.
   Die erste Welle einer Phase startet zuerst einen frischen Phasenprüfer (t1439): `kermach roadmap wave <Phase>` antwortet mit Code 4
   und dem Text „проверка фазы идёт" (Phasenprüfung läuft; die Zeile des Programms ist russisch). Das ist kein Fehler. Sag dem Menschen in einer Zeile, dass ein frischer Agent die Phase prüft, und beende den Zug.
   Das Ergebnis gibt das Programm in diesen Tab als Zeile „[Роадмап] Проверка фазы <Phase>, круг N из 2: …" mit dem Pfad zur Analyse aus (`.kermach/grades/phase-<Phase>-K.md`):
   - keine ernsten — wieder `kermach roadmap wave <Phase>`: die Welle startet. Die kleinen aus der Analyse zeige dem Menschen;
   - ernste in Runde 1 — öffne die Analyse, korrigiere die Karten der Phase (Entwurf ergänzen und `draft: да` entfernen, „Wie prüfen", Abnahme-Änderungen, Kriterien),
     dann wieder `wave`: Runde 2 beginnt. Eine Änderung verändert den Sinn, über den der Mensch nicht gesprochen hat — frag ihn zuerst;
   - nach Runde 2 bleiben Anmerkungen — zeige sie dem Menschen vor dem Start. Sagt er starten — wieder `wave`: die Welle läuft über die Anmerkungen hinweg;
   - die Prüfung hat nicht stattgefunden — sag dem Menschen, dass niemand die Phase geprüft hat; das nächste `wave` startet die Welle ohne Prüfung.
   Es gibt keine nächste Phase — sag, dass die Roadmap zu Ende ist, schlage keine neuen Phasen vor: sie werden auf das Wort des Menschen angelegt.
11. Der Mensch hat auf Schritt 7 nicht geantwortet und gesagt, weiterzuarbeiten. Nimm die Phase nicht ab, ändere das Board nicht nach der abgestimmten Liste.
   Schreibe in „Jetzt": „Phase {фаза} wartet auf Abnahme: <was nicht geprüft ist>". Die nächste Phase startest du nur mit dieser Zeile in „Jetzt"
   und mit einer Warnung an den Menschen in der allerersten Nachricht: „<Phase> läuft über der nicht abgenommenen {фаза}".
