require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Endpoint 1: prepoznavanje predmeta sa slike preko Gemini AI (besplatan tier)
app.post('/api/identify', async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Nedostaje slika.' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server nije podesen: nedostaje GEMINI_API_KEY (proveri .env fajl ili podesavanja hostinga).' });
    }

    const prompt = 'Na slici se nalazi neki svakodnevni predmet (moze biti bilo sta: daljinski upravljac, tastatura, ceslja, solja, alat, odevni predmet, kuhinjski pribor, elektronika, obuca...). Identifikuj GLAVNI predmet, cak i ako je delimicno zaklonjen ili nije idealno uslikan. Odgovori ISKLJUCIVO validnim JSON objektom, bez markdown ograda, u sledecem obliku: {"name_sr": "kratak naziv predmeta na srpskom", "name_en": "short name in English", "category": "kategorija na srpskom", "search_terms_sr": "kratka fraza na srpskom pogodna za pretragu prodavnica koje prodaju taj predmet"}';

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { text: prompt }
          ]
        }],
        generationConfig: {
          response_mime_type: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'Greska Gemini servisa (' + response.status + '): ' + errText.slice(0, 300) });
    }

    const data = await response.json();
    const candidate = (data.candidates || [])[0];
    const textPart = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.find(p => p.text)
      : null;

    if (!textPart || !textPart.text) {
      return res.status(502).json({ error: 'Prazan odgovor od modela.' });
    }

    let cleaned = textPart.text.replace(/```json|```/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last !== -1) cleaned = cleaned.slice(first, last + 1);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      parsed = {
        name_sr: cleaned.slice(0, 60),
        name_en: '',
        category: 'predmet',
        search_terms_sr: cleaned.slice(0, 60)
      };
    }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Greska na serveru: ' + err.message });
  }
});

// Endpoint 2: pretraga prodavnica u okolini preko Google Places API
app.post('/api/nearby', async (req, res) => {
  try {
    const { query, lat, lng, cityFallback } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Nedostaje pojam za pretragu.' });
    }
    if (!GOOGLE_PLACES_API_KEY) {
      return res.status(500).json({ error: 'Server nije podesen: nedostaje GOOGLE_PLACES_API_KEY (proveri .env fajl ili podesavanja hostinga).' });
    }

    const textQuery = cityFallback ? (query + ' ' + cityFallback) : query;
    const body = { textQuery, languageCode: 'sr' };

    if (lat && lng) {
      body.locationBias = {
        circle: { center: { latitude: lat, longitude: lng }, radius: 8000 }
      };
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.rating,places.googleMapsUri,places.currentOpeningHours.openNow'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'Greska Google Places servisa (' + response.status + '): ' + errText.slice(0, 300) });
    }

    const data = await response.json();
    const places = (data.places || []).map(p => ({
      name: p.displayName ? p.displayName.text : 'Nepoznato',
      address: p.formattedAddress || '',
      lat: p.location ? p.location.latitude : null,
      lng: p.location ? p.location.longitude : null,
      rating: p.rating || null,
      mapsUri: p.googleMapsUri || null,
      openNow: p.currentOpeningHours ? p.currentOpeningHours.openNow : null
    }));

    res.json({ places, usedQuery: textQuery });
  } catch (err) {
    res.status(500).json({ error: 'Greska na serveru: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server radi na portu ' + PORT));
