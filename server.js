const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const clients = new Set();

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

const port = 8080;
server.listen(port, () => {
  console.log(`WebSocket server is running on port ${port}`);
});