import React, { useState, useEffect, useRef } from 'react';

function App() {
  const [ws, setWs] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [receivedAudio, setReceivedAudio] = useState(null);
  const [transcription, setTranscription] = useState('');
  const audioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8080');
    setWs(socket);

    socket.onopen = () => {
      console.log('WebSocket connection established');
    };

    socket.onmessage = (event) => {
      console.log('Received audio data');
      const audioBlob = event.data;
      const audioUrl = URL.createObjectURL(audioBlob);
      setReceivedAudio(audioUrl);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    socket.onclose = () => {
      console.log('WebSocket connection closed');
    };

    return () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    if (receivedAudio && audioRef.current) {
      audioRef.current.src = receivedAudio;
      audioRef.current.play().catch(error => console.error('Audio playback error:', error));
    }
  }, [receivedAudio]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
        
        console.log('Audio Blob:', audioBlob);
        
        // If you still want to send via WebSocket
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(audioBlob);
        }

        // Send to server for transcription
        const formData = new FormData();
        formData.append('audio', audioBlob, 'audio.webm');
        
        fetch('http://localhost:8080/transcribe_by_language', {
          method: 'POST',
          body: formData
        })
        .then(response => response.json())
        .then(data => {
          console.log('Transcription:', data.transcription);
          setTranscription(data.transcription);
        })
        .catch(error => console.error('Error:', error));
        
        chunksRef.current = [];
      };
    }
  };

  return (
    <div className="App">
      <h1>PhonePal (test) </h1>
      <div>
        <button onClick={startRecording} disabled={isRecording}>
          Start Recording
        </button>
        <button onClick={stopRecording} disabled={!isRecording}>
          Stop Recording and Send
        </button>
      </div>
      <div>
        <h2>Received Audio</h2>
        <audio ref={audioRef} controls />
      </div>
      <div>
        <h2>Transcription</h2>
        <p>{transcription}</p>
      </div>
    </div>
  );
}

export default App;