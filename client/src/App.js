import React, { useState, useEffect, useRef, useCallback } from 'react';

// Languages available on Cartesia API
const languages = [
  { code: "", name: "Not Selected" },
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "hi", name: "Hindi" },
];

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
  const [userVoiceId, setUserVoiceId] = useState(null);
  const [isProcessingOwnMessage, setIsProcessingOwnMessage] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [partnerLanguage, setPartnerLanguage] = useState('');

  const handleLanguageChange = (event) => {
    const newLanguage = event.target.value;
    setSelectedLanguage(newLanguage);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'language', language: newLanguage }));
    }
  };  

  const handleMessage = useCallback((event) => {
    console.log("Message received, isSender:", isSender, "isProcessingOwnMessage:", isProcessingOwnMessage);
    if (!isSender && !isProcessingOwnMessage) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'transcription') {
          console.log('Received transcription:', data.text);
          setReceivedTranscription(data.text);
        } else if (data.type === 'language') {
          console.log('Received partner language:', data.language);
          setPartnerLanguage(data.language);
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

  const handleVoiceSampleUpload = async (event) => {
    const file = event.target.files[0];
    if (file) {
      const formData = new FormData();
      formData.append('voiceSample', file);
  
      try {
        const response = await fetch('http://localhost:8080/clone-voice', {
          method: 'POST',
          body: formData,
        });
  
        if (response.ok) {
          const data = await response.json();
          setUserVoiceId(data.voiceId);
          console.log('Voice cloned successfully, ID:', data.voiceId);
          
          // Send the new voiceId to the server via WebSocket
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'voiceId', voiceId: data.voiceId }));
          }
        } else {
          console.error('Failed to clone voice');
        }
      } catch (error) {
        console.error('Error uploading voice sample:', error);
      }
    }
  };

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8080');
    setWs(socket);
  
    socket.onopen = () => {
      console.log('WebSocket connection established');
      if (userVoiceId) {
        socket.send(JSON.stringify({ type: 'voiceId', voiceId: userVoiceId }));
      }
      socket.send(JSON.stringify({ type: 'language', language: selectedLanguage }));
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
  }, [userVoiceId, selectedLanguage, handleMessage]);

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
        formData.append('voiceId', userVoiceId); 
        
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
        <h2>Language Selection</h2>
        <select value={selectedLanguage} onChange={handleLanguageChange}>
          {languages.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <h2>Partner's Language</h2>
        <p>{languages.find(lang => lang.code === partnerLanguage)?.name || 'Not selected'}</p>
      </div>
      <div>
        <h2>Upload Voice Sample</h2>
        <input type="file" accept="audio/*" onChange={handleVoiceSampleUpload} />
        {userVoiceId && <p>Voice ID: {userVoiceId}</p>}
      </div>
      <div>
        <h2>Communicate!</h2>
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