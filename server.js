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

    const prompt = 'Na slici se nalazi neki svakodnevni predmet (moze biti bilo sta: daljinski upravljac, tastatura, ceslja, solja, alat, odevni predmet, kuhinjski pribor, elektronika, obuca...). Identifikuj GLAVNI predmet, cak i ako je delimicno zaklonjen ili nije idealno uslikan.';

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify({
        model: 'gemini-3.5-flash',
        input: [
          { type: 'text', text: prompt },
          { type: 'image', data: imageBase64, mime_type: mediaType || 'image/jpeg' }
        ],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: {
            type: 'object',
            properties: {
              name_sr: { type: 'string', description: 'kratak naziv predmeta na srpskom' },
              name_en: { type: 'string', description: 'short name in English' },
              category: { type: 'string', description: 'kategorija na srpskom' },
              search_terms_sr: { type: 'string', description: 'kratka fraza na srpskom pogodna za pretragu prodavnica koje prodaju taj predmet' }
            },
            required: ['name_sr', 'name_en', 'category', 'search_terms_sr']
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'Greska Gemini servisa (' + response.status + '): ' + errText.slice(0, 300) });
    }

    const data = await response.json();

    function findOutputText(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (typeof obj.output_text === 'string') return obj.output_text;
      if (obj.output && typeof obj.output.text === 'string') return obj.output.text;
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === 'string' && key === 'text' && val.trim().startsWith('{')) return val;
        if (typeof val === 'object') {
          const found = findOutputText(val);
          if (found) return found;
        }
      }
      return null;
    }

    const rawText = findOutputText(data);
    if (!rawText) {
      return res.status(502).json({ error: 'Prazan odgovor od modela.' });
    }

    let cleaned = rawText.replace(/```json|```/g, '').trim();
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
