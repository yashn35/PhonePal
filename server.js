const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const upload = multer({ storage: multer.memoryStorage() });

const clients = new Set();

require('dotenv').config();


wss.on('connection', (ws) => {
  clients.add(ws);

  ws.on('message', (message) => {
    // Broadcast the message to all connected clients except the sender
    clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

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

app.post('/transcribe_by_language', upload.single('audio'), async (req, res) => {
  try {
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
    res.json({ transcription: data.text });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Transcription failed', details: error.message });
  }
});

const port = 8080;
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});