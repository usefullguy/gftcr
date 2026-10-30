# Sturmflut

Luft- und Seegefechte im Browser. Blau gegen Rot, 7 gegen 7, die Gegner und Mitspieler sind KI.

- **Flugzeuge:** Falke (Jäger), Habicht (zweimotorig, Raketen), Bussard (Bomber)
- **Schiffe:** Schnellboot (Torpedos), Zerstörer, Kreuzer
- **Modus:** Drei Zonen (A, B, C) werden von Schiffen eingenommen. Wer mehr Zonen hält, zieht dem Gegner Punkte ab. Abschüsse kosten ebenfalls Punkte. Wer zuerst bei 0 ist oder nach 15 Minuten weniger Punkte hat, verliert.
- **Serien:** Abschüsse ohne selbst abgeschossen zu werden schalten Fahrzeuge frei und geben Belohnungen (Reparatur, Begleitschutz, Sperrfeuer). Freischaltungen werden im Browser gespeichert.

## Spielen

Über GitHub Pages: `https://anonypeg.github.io/gftcr/`

Lokal (braucht einen kleinen Webserver, weil ES-Module nicht per `file://` laden):

```bash
cd web
python3 -m http.server 8000
```

Dann `http://localhost:8000` öffnen.

## Steuerung

| | Flugzeug | Schiff |
|---|---|---|
| Maus | Zielrichtung, das Flugzeug fliegt hinterher | Zielen, die Türme drehen nach |
| Linke Maustaste | Bordwaffen | Feuer |
| Rechte Maustaste / Leertaste | Bomben / Raketen | Torpedos |
| W / S | Schub | Fahrstufe |
| A / D | Rollen | Ruder |

Shift: Zoom · C: Umschauen · Mausrad: Kameraabstand · F: Sperrfeuer · Tab: Punktetabelle · Esc: Pause

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
  js/world.js       Meer, Inseln, Himmel, Wolken
  js/models.js      Low-Poly-Modelle aus Grundkörpern
  js/effects.js     Feuer, Rauch, Gischt
  js/hud.js         Anzeigen, Minikarte
  js/audio.js       Klänge (zur Laufzeit erzeugt)
  vendor/           three.js r160 (MIT)
```

## Veröffentlichen

Der Workflow `.github/workflows/pages.yml` veröffentlicht `web/` bei jedem Push auf `main`.
Einmalig nötig: im Repository unter **Settings → Pages → Source** „GitHub Actions“ auswählen.
