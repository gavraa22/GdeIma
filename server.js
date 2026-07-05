require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Endpoint 1: prepoznavanje predmeta sa slike preko OpenRouter (besplatan model, bez kartice)
app.post('/api/identify', async (req, res) => {
  try {
    const { imageBase64, mediaType } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Nedostaje slika.' });
    }
    if (!OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'Server nije podesen: nedostaje OPENROUTER_API_KEY (proveri .env fajl ili podesavanja hostinga).' });
    }

    const prompt = 'Na slici se nalazi neki svakodnevni predmet (moze biti bilo sta: daljinski upravljac, tastatura, ceslja, solja, alat, odevni predmet, kuhinjski pribor, elektronika, obuca...). Identifikuj GLAVNI predmet, cak i ako je delimicno zaklonjen ili nije idealno uslikan. Odgovori ISKLJUCIVO validnim JSON objektom, bez markdown ograda i bez ikakvog teksta pre ili posle JSON-a, u sledecem obliku: {"name_sr": "kratak naziv predmeta na srpskom", "name_en": "short name in English", "category": "kategorija na srpskom", "search_terms_sr": "kratka fraza na srpskom pogodna za pretragu prodavnica koje prodaju taj predmet"}';

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENROUTER_API_KEY,
        'HTTP-Referer': 'https://gdeima.onrender.com',
        'X-Title': 'GdeIma'
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-maverick:free',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:' + (mediaType || 'image/jpeg') + ';base64,' + imageBase64 } }
          ]
        }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: 'Greska OpenRouter servisa (' + response.status + '): ' + errText.slice(0, 300) });
    }

    const data = await response.json();
    const rawText = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;

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
