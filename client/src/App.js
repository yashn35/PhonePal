import React, { useState, useEffect, useRef, useCallback } from 'react';

function App() {
  const [ws, setWs] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [receivedAudio, setReceivedAudio] = useState(null);
  const [transcription, setTranscription] = useState('');
  const [receivedTranscription, setReceivedTranscription] = useState('');
  const audioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const [isSender, setIsSender] = useState(false);

  const [isProcessingOwnMessage, setIsProcessingOwnMessage] = useState(false);

  const handleMessage = useCallback((event) => {
    console.log("Message received, isSender:", isSender, "isProcessingOwnMessage:", isProcessingOwnMessage);
    if (!isSender && !isProcessingOwnMessage) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'transcription') {
          console.log('Received transcription:', data.text);
          setReceivedTranscription(data.text);
        } else {
          console.log('Received audio data');
          const audioBlob = new Blob([event.data], { type: 'audio/wav' });
          const audioUrl = URL.createObjectURL(audioBlob);
          setReceivedAudio(audioUrl);
          
          const audio = new Audio(audioUrl);
          audio.play().catch(error => console.error('Audio playback error:', error));
        }
      } catch (error) {
        console.log('Received audio data');
        const audioBlob = event.data;
        const audioUrl = URL.createObjectURL(audioBlob);
        setReceivedAudio(audioUrl);
      }
    } else {
      console.log("Ignoring own message");
    }
  }, [isSender, isProcessingOwnMessage]);

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8080');
    setWs(socket);
  
    socket.onopen = () => {
      console.log('WebSocket connection established');
    };
  
    socket.onmessage = handleMessage;
  
    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  
    socket.onclose = () => {
      console.log('WebSocket connection closed');
    };
  
    return () => {
      socket.close();
    };
  }, [handleMessage]);

  useEffect(() => {
    if (receivedAudio && audioRef.current) {
      audioRef.current.src = receivedAudio;
      audioRef.current.play().catch(error => console.error('Audio playback error:', error));
    }
  }, [receivedAudio]);

  const startRecording = async () => {
    setIsRecording(true);
    setIsSender(true);
    try {
      let stream;
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        console.log('Using standard getUserMedia');
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else if (navigator.getUserMedia) {
        console.log('Using deprecated getUserMedia');
        stream = await new Promise((resolve, reject) => {
          navigator.getUserMedia({ audio: true }, resolve, reject);
        });
      } else if (navigator.webkitGetUserMedia) {
        console.log('Using webkitGetUserMedia');
        stream = await new Promise((resolve, reject) => {
          navigator.webkitGetUserMedia({ audio: true }, resolve, reject);
        });
      } else if (navigator.mozGetUserMedia) {
        console.log('Using mozGetUserMedia');
        stream = await new Promise((resolve, reject) => {
          navigator.mozGetUserMedia({ audio: true }, resolve, reject);
        });
      } else {
        throw new Error('No getUserMedia method found');
      }
  
      console.log('Microphone access granted');
      
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
      alert(`An error occurred while trying to start recording: ${error.message}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      console.log("CLICKED STOP");
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsProcessingOwnMessage(true);

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm;codecs=opus' });
        
        console.log('Audio Blob:', audioBlob);
        
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
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'transcription',
              text: data.transcription
            }));
          }
          setIsProcessingOwnMessage(false);
          setIsSender(false);
        })
        .catch(error => {
          console.error('Error:', error);
          setIsProcessingOwnMessage(false);
          setIsSender(false);
        });
        
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
        <h2>Your Transcription</h2>
        <p>{transcription}</p>
      </div>
      <div>
        <h2>Received Transcription</h2>
        <p>{receivedTranscription}</p>
      </div>
    </div>
  );
}

export default App;