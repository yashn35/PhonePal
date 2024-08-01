const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const cors = require('cors');
const groq = require('groq-sdk');
const WavEncoder = require('wav-encoder'); 
const app = express();

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

require('dotenv').config();
const groqClient = new groq.Groq( {apiKey: process.env.GROQ_API_KEY});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const upload = multer({ storage: multer.memoryStorage() });
const clients = new Set();

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
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

// API TO INSTANT CLONE VOICE 
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


// THIS USES THE FULL PIPELINE: TRANSCRIBE -> TRANSLATE -> GENERaTE AUDIO
app.post('/transcribe_by_language', upload.single('audio'), async (req, res) => {
  try {
    const voiceId = req.body.voiceId || "a0e99841-438c-4a64-b679-ae501e7d6091";
    const senderLanguage = req.body.senderLanguage;
    const receiverLanguage = req.body.receiverLanguage;
    console.log('Received voiceId:', voiceId);
    console.log('Sender Language:', senderLanguage);
    console.log('Receiver Language:', receiverLanguage);

    // First transcribe audio in the sender's language
    const transcription = await getTranscript(req);
    console.log('Transcription:', transcription);

    // Then translates into to RECEIVER's language
    const translation = await translateText(transcription, receiverLanguage);
    console.log('Translation:', translation);

    // Generates audio from translated text
    const wavData = await generateAudio(translation, voiceId, receiverLanguage);

    // Broadcast the audio to all clients except the sender
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client !== req.ws) {
        client.send(wavData);
      }
    });

    res.json({ transcription: transcription, translation: translation });
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ error: 'Processing failed', details: error.message });
  }
});

// GET TRANSCRIPT IN THE SENDER'S LANGUAGE 
async function getTranscript(rawAudio) {
  try {
    const form = new FormData();
    form.append('file', rawAudio.file.buffer, {
      filename: 'audio.webm',
      contentType: rawAudio.file.mimetype,
    });
    form.append('model', 'whisper-large-v3');
    form.append('temperature', '0');
    form.append('response_format', 'json');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
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
    return data.text.trim() || null;
  } catch (error) {
    console.error('Transcription error:', error);
    return null;
  }
}

// TRANSLATE TRANSCRIPT INTO RECEIVER's LANGUAGE (AS THIS IS WHAT THEY NEED TO HEAR THINGS IN)
async function translateText(text, targetLanguage) {
  try {
    const stream = await groqClient.chat.completions.create({
      model: "llama3-8b-8192",
      messages: [
        {
          role: "system",
          content: `You are a TRANSLATOR. ONLY TRANSLATE THE INPUT TEXT INTO THE TARGET LANGUAGE.`,
        },
        {
          role: "user",
          content: `Translate the following sentence into ${targetLanguage}; ONLY INCLUDE TRANSLATION, NOTHING ELSE: ${text}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 1024,
      stream: true,
    });

    let translation = '';
    for await (const chunk of stream) {
      translation += chunk.choices[0]?.delta?.content || '';
    }
    return translation.trim();
  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
}

// GENERATE AUDIO FOR THE RECEIVER
async function generateAudio(text, voiceId, language) {
  try {
    console.log('Generating audio for text:', text);
    const usedVoiceID = voiceId || "a0e99841-438c-4a64-b679-ae501e7d6091";

    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: 'POST',
      headers: {
        "Cartesia-Version": "2024-06-10",
        "X-API-Key": process.env.CARTESIA_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "transcript": text,
        "model_id": language === "en" ? "sonic-english" : "sonic-multilingual",
        "voice": {"mode":"id", "id": usedVoiceID},
        "output_format":{"container":"raw", "encoding":"pcm_f32le", "sample_rate":44100},
        "language": language
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

const port = 8080;
server.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});