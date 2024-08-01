const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: '*', // Be cautious with this in production
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const https = require('https');
const fs = require('fs');

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const upload = multer({ storage: multer.memoryStorage() });

const clients = new Set();

require('dotenv').config();

wss.on('connection', (ws) => {
  ws.voiceId = null;
  clients.add(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'voiceId') {
        ws.voiceId = data.voiceId;
        console.log('Updated voiceId for client:', ws.voiceId);
      } else if (data.type === 'language') {
        ws.language = data.language;
        console.log('Updated language for client:', ws.language);
        // Broadcast the language to all other clients
        clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'language',
              language: data.language
            }));
          }
        });
      } else if (data.type === 'transcription') {
        // Existing transcription broadcast code...
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

// TRANSCRIBES AUDIO AND DIRECTLY TRANSLATES TO ENGLISH and GENERATES NEW AUDIO FROM TRANSCRIPT 
app.post('/transcribe_by_language', upload.single('audio'), async (req, res) => {
  try {
    const voiceId = req.body.voiceId || "a0e99841-438c-4a64-b679-ae501e7d6091";  
    console.log('Received voiceId:', voiceId);

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: 'audio.webm',
      contentType: req.file.mimetype,
    });
    form.append('model', 'whisper-large-v3');
    form.append('temperature', '0');
    form.append('response_format', 'json');

    const response = await fetch('https://api.groq.com/openai/v1/audio/translations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        ...form.getHeaders()
      },
      body: form
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(JSON.stringify(errorData));
    }

    const data = await response.json();
    
    // Generate audio from the transcription using the provided voiceId
    const wavData = await generateAudio(data.text, voiceId);

    // Broadcast the audio to all clients except the sender
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client !== req.ws) {
        client.send(wavData);
      }
    });

    res.json({ transcription: data.text });
  } catch (error) {
    console.error('Transcription or audio generation error:', error);
    res.status(500).json({ error: 'Transcription or audio generation failed', details: error.message });
  }
});

// GENERATES AUDIO FROM TRANSCRIPT
const WavEncoder = require('wav-encoder');

async function generateAudio(text, voiceId) {
  try {
    console.log('Generating audio for text:', text);
    const usedVoiceID = voiceId || "a0e99841-438c-4a64-b679-ae501e7d6091"

    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: 'POST',
      headers: {
        "Cartesia-Version": "2024-06-10",
        "X-API-Key": process.env.CARTESIA_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "transcript": text,
        "model_id": "sonic-english",
        "voice": {"mode":"id", "id": usedVoiceID},
        "output_format":{"container":"raw", "encoding":"pcm_f32le", "sample_rate":44100}
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const float32Array = new Float32Array(arrayBuffer);

    // Convert to WAV
    const wavData = await WavEncoder.encode({
      sampleRate: 44100,
      channelData: [float32Array]
    });

    console.log('Generated WAV audio buffer size:', wavData.byteLength);
    return wavData;
  } catch (error) {
    console.error('Error generating audio:', error);
    throw error;
  }
}

app.post('/clone-voice', upload.single('voiceSample'), async (req, res) => {
  try {
    const form = new FormData();
    form.append('clip', req.file.buffer, {
      filename: 'voice_sample.wav',
      contentType: req.file.mimetype,
    });

    // Clone the voice
    const cloneResponse = await fetch('https://api.cartesia.ai/voices/clone/clip', {
      method: 'POST',
      headers: {
        'Cartesia-Version': '2024-06-10',
        'X-API-Key': process.env.CARTESIA_API_KEY,
        ...form.getHeaders()
      },
      body: form
    });

    if (!cloneResponse.ok) {
      throw new Error(`Failed to clone voice: ${await cloneResponse.text()}`);
    }

    const clonedVoice = await cloneResponse.json();

    // Create a voice with the embedding
    const createVoiceResponse = await fetch('https://api.cartesia.ai/voices', {
      method: 'POST',
      headers: {
        'Cartesia-Version': '2024-06-10',
        'X-API-Key': process.env.CARTESIA_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `Cloned Voice ${Date.now()}`,
        description: "A voice cloned from an audio sample.",
        embedding: clonedVoice.embedding
      })
    });

    if (!createVoiceResponse.ok) {
      throw new Error(`Failed to create voice: ${await createVoiceResponse.text()}`);
    }

    const createdVoice = await createVoiceResponse.json();
    res.json({ voiceId: createdVoice.id });
  } catch (error) {
    console.error('Error cloning voice:', error);
    res.status(500).json({ error: 'Failed to clone voice', details: error.message });
  }
});

// TRANSCRIBES ONLY AUDIO
// app.post('/transcribe', upload.single('audio'), async (req, res) => {
//   try {
//     const form = new FormData();
//     form.append('file', req.file.buffer, {
//       filename: 'audio.webm',
//       contentType: req.file.mimetype,
//     });
//     form.append('model', 'whisper-large-v3');
//     form.append('temperature', '0');
//     form.append('response_format', 'json');
//     form.append('language', 'en');

//     const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
//       method: 'POST',
//       headers: {
//         'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
//         ...form.getHeaders()
//       },
//       body: form
//     });

//     if (!response.ok) {
//       const errorData = await response.json();
//       throw new Error(JSON.stringify(errorData));
//     }

//     const data = await response.json();
//     res.json({ transcription: data.text });
//   } catch (error) {
//     console.error('Transcription error:', error);
//     res.status(500).json({ error: 'Transcription failed', details: error.message });
//   }
// });

const port = 8080;
server.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});