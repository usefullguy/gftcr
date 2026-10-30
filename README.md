# Sturmflut

Luft-, See- und Stadtgefechte im Browser. Blau gegen Rot, 7 gegen 7. Allein gegen KI oder mit anderen online.

- **Karten:** Inselmeer (Flugzeuge und Schiffe) und Stadt (Panzer)
- **Flugzeuge (9):** Sperber, Falke, Specht, Habicht, Uhu, Möwe (Lufttorpedo), Bussard, Kondor (viermotorig), Milan (Strahljäger)
- **Schiffe (3):** Schnellboot, Zerstörer, Kreuzer
- **Panzer (3):** Dachs, Keiler, Wisent
- **Modus:** Drei Zonen (A, B, C) werden von Schiffen eingenommen. Wer mehr Zonen hält, zieht dem Gegner Punkte ab. Abschüsse kosten ebenfalls Punkte. Wer zuerst bei 0 ist oder nach 15 Minuten weniger Punkte hat, verliert.
- **Serien:** Abschüsse ohne selbst abgeschossen zu werden schalten Fahrzeuge frei und geben Belohnungen (Reparatur, Begleitschutz, Sperrfeuer). Freischaltungen werden im Browser gespeichert.

## Mehrspieler

- **Schnelles Gefecht:** tritt einem offenen Raum bei oder eröffnet selbst einen, Spieler gegeneinander, Lücken füllt die KI.
- **Raum erstellen:** zeigt einen Code mit 5 Zeichen. „Kopieren“ legt einen Einladungslink (`?raum=CODE`) in die Zwischenablage. Modus „Zusammen gegen KI“ oder „Gegeneinander“.
- **Raum beitreten:** Code eingeben. Wer später kommt, steigt direkt ins laufende Gefecht ein.

Technik: WebRTC über [PeerJS](https://peerjs.com). Der Host rechnet das Spiel, die anderen schicken ihre Eingaben und bekommen 15-mal pro Sekunde den Spielstand. Zum Verbindungsaufbau wird der kostenlose öffentliche PeerJS-Server benutzt, danach laufen die Daten direkt zwischen den Browsern. In sehr strengen Netzwerken (manche Schul- oder Firmennetze) kann WebRTC blockiert sein. Ein eigener Server lässt sich mit `?peer=host:port` angeben.

## Spielen

Über GitHub Pages: `https://anonypeg.github.io/gftcr/`

Lokal (braucht einen kleinen Webserver, weil ES-Module nicht per `file://` laden):

```bash
cd web
python3 -m http.server 8000
```

Dann `http://localhost:8000` öffnen.

## Steuerung

Alles geht nur mit Tastatur, die Maus ist optional.

| | Flugzeug | Schiff | Panzer |
|---|---|---|---|
| Pfeiltasten | Nicken und Rollen | Zielen | Turm und Rohr |
| W / S | Schub | Fahrstufe | Fahren |
| A / D | Seitenruder | Ruder | Drehen |
| Leertaste | Bordwaffen | Feuer | Feuer |
| E | Bomben, Raketen, Torpedo | Torpedos | |
| Maus (optional) | Flugzeug fliegt zur Blickrichtung | Zielen | Zielen |

Shift: Zoom · F: Sperrfeuer · Tab: Punktetabelle · Esc: Pause · Im Hangar: Pfeile wählen, Enter steigt ein

## Aufbau

Kein Build-Schritt. Alles in `web/` wird so ausgeliefert, wie es ist.

```
web/
  index.html        Menüs, HUD
  css/style.css
  js/main.js        Ablauf, Eingabe, Kamera
  js/game.js        Teams, Zonen, Punkte, Serien
  js/vehicles.js    Fahrzeugwerte, Flug- und Schiffsphysik, Waffen
  js/ai.js          KI für Flugzeuge und Schiffe
  js/weapons.js     Geschosse, Treffer, Splitterschaden
  js/world.js       Meer, Inseln, Himmel, Wolken, Kartenwechsel
  js/city.js        Stadtkarte: Straßenraster, Gebäude, Plätze
  js/preview.js     Vorschaubilder der Fahrzeuge für den Hangar
  js/models.js      Low-Poly-Modelle aus Grundkörpern
  js/effects.js     Feuer, Rauch, Gischt
  js/hud.js         Anzeigen, Minikarte
  js/audio.js       Klänge mit Web Audio: 3D-Raumklang, Hall, Schallverzögerung
  js/render.js      Nachbearbeitung: Bloom, SMAA, Vignette, Farbabstimmung
  js/ui.js          UI-Animationen, Tarnmuster-Übergang
  js/net.js         Mehrspieler: Host, Client, Spiegelbild beim Client
  vendor/           three.js r160 (MIT), postprocessing 6.35 (Zlib), GSAP 3.15 (GSAP Standard License), PeerJS 1.5 (MIT)
  fonts/            Black Ops One, Rajdhani (SIL Open Font License)
```

Grafikstufe „Niedrig“ schaltet Nachbearbeitung, Schatten und Explosionslichter ab, für ältere Schul-PCs.

Alle Dateien werden mit `?v=N` eingebunden, damit Browser nach einem Update keine alten Module aus dem Cache mischen. Bei jeder Veröffentlichung `python3 tools/bump_version.py` ausführen.

Für automatisierte Tests gibt es `index.html?debug` (stellt `window.__dbg` bereit).

## Veröffentlichen

Der Workflow `.github/workflows/pages.yml` veröffentlicht `web/` bei jedem Push auf `main`.
Einmalig nötig: im Repository unter **Settings → Pages → Source** „GitHub Actions“ auswählen.
