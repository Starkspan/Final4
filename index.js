
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const sharp = require('sharp');
const pdf = require('pdf-parse');
const app = express();
const port = process.env.PORT || 10000;
const upload = multer();

app.use(cors());
app.use(express.json());

const visionClient = new ImageAnnotatorClient();

app.post('/pdf/analyze', upload.single('pdf'), async (req, res) => {
  try {
    const textBuffer = req.file.buffer;
    const pdfText = await pdf(textBuffer);
    const text = pdfText.text;

    const zahlen = Array.from(text.matchAll(/\d+(\.\d+)?/g)).map(m => parseFloat(m[0]));
    const werte = zahlen.filter(z => z >= 0.5 && z <= 1500).sort((a, b) => b - a);
    if (werte.length < 2) return res.json({ hinweis: "Nicht genügend Maße erkannt." });

    let form = "unbekannt", volumen = 0;
    let x1 = werte[0], x2 = werte[1], x3 = werte[2] || 10;

    if (x1 > 3 * x2) {
      form = "Profil/Rohr";
      volumen = x2 * x3 * x1 / 1000;
    } else if (Math.abs(x1 - x2) < 100 && Math.abs(x2 - x3) < 100) {
      form = "Platte/Klotz";
      volumen = x1 * x2 * x3 / 1000;
    } else if (werte.length === 2) {
      form = "Zylinder";
      const radius = x2 / 2;
      volumen = Math.PI * radius * radius * x1 / 1000;
    } else {
      form = "Standard";
      volumen = x1 * x2 * x3 / 1000;
    }

    // Gewicht aus Text extrahieren (z. B. "0.006 kg")
    const kgMatch = text.match(/\d+(\.\d+)?\s?kg/);
    let gewicht = kgMatch ? parseFloat(kgMatch[0]) : volumen * 7.85;

    // Material aus Text
    const textLower = text.toLowerCase();
    let material = 'stahl';
    if (textLower.includes('alu') || textLower.includes('6082')) material = 'aluminium';
    else if (textLower.includes('edelstahl') || textLower.includes('1.4301')) material = 'edelstahl';
    else if (textLower.includes('messing') || textLower.includes('ms58')) material = 'messing';
    else if (textLower.includes('kupfer')) material = 'kupfer';

    const dichten = {
      aluminium: 2.7,
      edelstahl: 7.9,
      stahl: 7.85,
      messing: 8.4,
      kupfer: 8.9
    };
    const kgPreise = {
      aluminium: 7,
      edelstahl: 6.5,
      stahl: 1.5,
      messing: 8,
      kupfer: 10
    };

    if (gewicht > 50 && Math.max(x1, x2, x3) > 100) {
      return res.json({
        form,
        x1, x2, x3,
        material,
        gewicht: gewicht.toFixed(2),
        hinweis: "Bauteil zu groß – bitte manuell prüfen"
      });
    }

    const stueckzahl = parseInt(req.body.stueckzahl) || 1;
    const zielpreis = req.body.zielpreis || null;

    const materialkosten = gewicht * kgPreise[material];
    const laufzeit_min = gewicht * 2;
    const laufzeit_std = laufzeit_min / 60;
    const bearbeitungskosten = laufzeit_std * 35;
    const ruestkosten = 60;
    const programmierkosten = 30;
    const grundkosten = ruestkosten + programmierkosten;
    const einzelpreis_roh = (materialkosten + bearbeitungskosten + grundkosten) / stueckzahl;
    const einzelpreis_final = einzelpreis_roh * 1.15;

    if (einzelpreis_final > 10000) {
      return res.json({
        form,
        x1, x2, x3,
        material,
        gewicht: gewicht.toFixed(2),
        preis: einzelpreis_final.toFixed(2),
        hinweis: "Preis zu hoch – bitte manuell prüfen"
      });
    }

    res.json({
      form,
      material,
      x1, x2, x3,
      gewicht: gewicht.toFixed(2),
      laufzeit_min: laufzeit_min.toFixed(1),
      materialkosten: materialkosten.toFixed(2),
      einzelpreis_final: einzelpreis_final.toFixed(2),
      zielpreis,
      stueckzahl
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fehler bei der Analyse' });
  }
});

app.listen(port, () => {
  console.log(`✅ Server läuft auf Port ${port}`);
});
