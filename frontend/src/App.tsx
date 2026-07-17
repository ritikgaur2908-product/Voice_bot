import { useState, useEffect, useRef } from 'react';
import { Waveform } from './components/Waveform';
import './App.css';

interface Message {
  role: 'user' | 'agent';
  text: string;
  complianceBlocked?: boolean;
  inputType?: 'voice' | 'text';
  timestamp?: string;
}



let rawBackendUrl = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
if (!/^https?:\/\//i.test(rawBackendUrl) && !/^wss?:\/\//i.test(rawBackendUrl)) {
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http';
  rawBackendUrl = `${protocol}://${rawBackendUrl}`;
}
const forceSecure = typeof window !== 'undefined' && window.location.protocol === 'https:' && !rawBackendUrl.includes('localhost');

const httpBackendUrl = (() => {
  let url = rawBackendUrl.startsWith('ws')
    ? rawBackendUrl.replace(/^ws/, 'http')
    : rawBackendUrl;
  if (forceSecure && url.startsWith('http://')) {
    url = url.replace(/^http:\/\//, 'https://');
  }
  return url;
})();

const wsBackendUrl = (() => {
  if (rawBackendUrl.startsWith('ws://') || rawBackendUrl.startsWith('wss://')) {
    if (forceSecure && rawBackendUrl.startsWith('ws://')) {
      return rawBackendUrl.replace(/^ws:\/\//, 'wss://');
    }
    return rawBackendUrl;
  }
  const wsProtocol = (rawBackendUrl.startsWith('https') || forceSecure) ? 'wss' : 'ws';
  const wsHost = rawBackendUrl.replace(/^https?:\/\//, '');
  return `${wsProtocol}://${wsHost}`;
})();

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionVariables, setSessionVariables] = useState<any>(null);
  const [secureLink, setSecureLink] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [interimText, setInterimText] = useState("");

  // Verification Form State
  const [showCompleteForm, setShowCompleteForm] = useState(false);
  const [formBookingCode, setFormBookingCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formSuccess, setFormSuccess] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const isCallingRef = useRef(isCalling);
  const isPlayingRef = useRef(isPlaying);

  useEffect(() => {
    isCallingRef.current = isCalling;
  }, [isCalling]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Check for redirect query parameter on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      setFormBookingCode(code);
      setShowCompleteForm(true);
    }
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isCalling, isPlaying]);

  const handleCompleteBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formBookingCode || !formName || !formEmail) return;
    setFormSubmitting(true);
    try {
      const res = await fetch(`${httpBackendUrl}/confirm-booking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingCode: formBookingCode,
          name: formName,
          email: formEmail,
          phone: formPhone,
          notes: formNotes
        })
      });
      if (res.ok) {
        setFormSuccess(true);
        // Clean URL parameter
        window.history.replaceState({}, document.title, window.location.pathname);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to submit form details.");
      }
    } catch (err) {
      console.error("Form submit error:", err);
      alert("Network error. Please try again.");
    } finally {
      setFormSubmitting(false);
    }
  };

  // Handle playing next audio response in queue
  const playNextAudio = () => {
    if (audioQueueRef.current.length === 0) {
      setIsPlaying(false);
      return;
    }

    const base64Data = audioQueueRef.current.shift();
    if (!base64Data) return;

    setIsPlaying(true);
    const audioBlob = base64ToBlob(base64Data, 'audio/mp3');
    const audioUrl = URL.createObjectURL(audioBlob);

    if (audioRef.current) {
      audioRef.current.src = audioUrl;
      audioRef.current.play().catch(err => {
        console.error("Audio playback failed:", err);
        playNextAudio();
      });
    }
  };

  const base64ToBlob = (base64: string, contentType: string) => {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  };

  // Ensure WebSocket Connection (Shared by Text & Voice)
  const ensureSocketConnection = async (enableMic: boolean): Promise<WebSocket> => {
    return new Promise(async (resolve, reject) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        if (enableMic && !isCalling) {
          await attachMicrophone(socketRef.current);
        }
        resolve(socketRef.current);
        return;
      }

      const socket = new WebSocket(wsBackendUrl);
      socketRef.current = socket;

      socket.onopen = async () => {
        setIsConnected(true);
        console.log("WebSocket connected.");
        if (enableMic) {
          await attachMicrophone(socket);
        }
        resolve(socket);
      };

      socket.onmessage = async (event) => {
        const payload = JSON.parse(event.data);

        if (payload.type === "transcript") {
          setInterimText("");
          setMessages(prev => {
            // Avoid duplicate logs if exact same text/speaker arrives
            const last = prev[prev.length - 1];
            if (last && last.role === (payload.speaker === "agent" ? "agent" : "user") && last.text === payload.text) {
              return prev;
            }
            return [...prev, { 
              role: payload.speaker === "agent" ? "agent" : "user", 
              text: payload.text,
              complianceBlocked: payload.complianceBlocked,
              inputType: payload.speaker === "user" ? (isCallingRef.current ? "voice" : "text") : undefined,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            }];
          });
        } 
        else if (payload.type === "transcript_interim") {
          setInterimText(payload.text);
        }
        else if (payload.type === "state_update") {
          setSessionVariables(payload.session);
          if (payload.session?.bookingCode) {
            setFormBookingCode(payload.session.bookingCode);
          }
        } 
        else if (payload.type === "audio_response") {
          audioQueueRef.current.push(payload.data);
          if (!isPlayingRef.current) {
            playNextAudio();
          }
        } 
        else if (payload.type === "barge_in") {
          // User started speaking — stop TTS playback immediately
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            audioRef.current.src = "";
          }
          audioQueueRef.current = [];
          setIsPlaying(false);
        }
        else if (payload.type === "booking_complete") {
          setSecureLink(payload.link);
          setFormBookingCode(payload.code || "");
        }
      };

      socket.onerror = (err) => {
        console.error("WebSocket error:", err);
        reject(err);
      };

      socket.onclose = () => {
        setIsConnected(false);
        setIsCalling(false);
        setIsPlaying(false);
      };
    });
  };

  // Attach Microphone stream to WebSocket using Web Audio API (raw PCM16)
  const attachMicrophone = async (socket: WebSocket) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      micStreamRef.current = stream;
      setIsCalling(true);

      // Create AudioContext at 16kHz for Deepgram compatibility
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      // Load AudioWorklet processor
      await ctx.audioWorklet.addModule('/pcm-processor.js');

      const source = ctx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(ctx, 'pcm-processor');
      workletNodeRef.current = workletNode;

      // Receive PCM16 chunks from worklet and send to backend
      workletNode.port.onmessage = (event: MessageEvent) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(event.data); // ArrayBuffer of Int16 samples
        }
      };

      source.connect(workletNode);
      workletNode.connect(ctx.destination); // needed to keep graph alive (silent)

    } catch (err) {
      console.error("Microphone access denied:", err);
      alert("Please allow microphone permissions to use voice mode.");
      setIsCalling(false);
    }
  };

  // Start Voice Call
  const startCall = async () => {
    try {
      await ensureSocketConnection(true);
    } catch (err) {
      console.error("Failed to start voice call:", err);
    }
  };

  // Stop Voice Call (Hangup mic, preserve chat)
  const stopCall = () => {
    setIsCalling(false);
    setInterimText("");

    // Stop AudioWorklet pipeline
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }
    // Legacy MediaRecorder cleanup (just in case)
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }
  };

  // Send Typed Text Message
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputText).trim();
    if (!text) return;

    setInputText("");

    // Optimistic user message addition
    setMessages(prev => [...prev, {
      role: 'user',
      text,
      inputType: 'text',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }]);

    try {
      const socket = await ensureSocketConnection(false);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "text_message", text }));
      }
    } catch (err) {
      console.error("Failed to send text message:", err);
    }
  };

  // Handle Quick Chat Suggestion Chips (Enables microphone automatically so user can speak the follow-up answer)
  const handleQuickChip = async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text) return;

    // Optimistic user message addition
    setMessages(prev => [...prev, {
      role: 'user',
      text,
      inputType: 'text',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }]);

    try {
      const socket = await ensureSocketConnection(true);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "text_message", text }));
      }
    } catch (err) {
      console.error("Failed to send quick chip message:", err);
    }
  };

  return (
    <div className="advisor-app-layout">
      {/* Audio element for Deepgram Aura TTS playback */}
      <audio 
        ref={el => {
          audioRef.current = el;
          if (el) {
            el.onended = playNextAudio;
          }
        }} 
        style={{ display: 'none' }}
      />

      {/* MINIMALIST TOP HEADER */}
      <header className="advisor-header">
        <div className="header-brand">
          <div className="brand-logo">🎙️</div>
          <div className="brand-titles">
            <h1>Advisor AI Scheduler</h1>
            <p>Financial & Consultation Assistant • 100% Compliance Gated</p>
          </div>
        </div>

        <div className="header-actions">
          <div className={`connection-pill ${isCalling ? 'live-voice' : isConnected ? 'online' : 'offline'}`}>
            <span className="pill-dot"></span>
            <span>{isCalling ? "🟣 Live Voice Mode" : isConnected ? "🟢 Online" : "⚪ Ready"}</span>
          </div>

        </div>
      </header>

      {/* MAIN CONVERSATION CHAT FEED */}
      <main className="chat-feed-container">
        {messages.length === 0 ? (
          <div className="zero-state-hero">
            <div className="hero-glow-circle">🎙️</div>
            <h2>How can I help schedule your consultation today?</h2>
            <p className="hero-subtitle">
              Speak or type to book, reschedule, or cancel your advisor consultation in real-time.
            </p>

            <div className="suggestion-chips-grid">
              <button 
                className="chip-item"
                onClick={() => handleQuickChip("I'd like to book a new appointment")}
              >
                <span className="chip-icon">➕</span>
                <div>
                  <strong>Book New Appointment</strong>
                  <span>Schedule a consultation slot</span>
                </div>
              </button>

              <button 
                className="chip-item"
                onClick={() => handleQuickChip("I need to reschedule my appointment")}
              >
                <span className="chip-icon">🔄</span>
                <div>
                  <strong>Reschedule Appointment</strong>
                  <span>Move an existing booking</span>
                </div>
              </button>

              <button 
                className="chip-item"
                onClick={() => handleQuickChip("I need to cancel my appointment")}
              >
                <span className="chip-icon">❌</span>
                <div>
                  <strong>Cancel Appointment</strong>
                  <span>Cancel an existing booking</span>
                </div>
              </button>

              <button 
                className="chip-item"
                onClick={() => handleQuickChip("When are advisors generally available?")}
              >
                <span className="chip-icon">🔍</span>
                <div>
                  <strong>Advisor Availability</strong>
                  <span>View working days and hours</span>
                </div>
              </button>

              <button 
                className="chip-item chip-span-2"
                onClick={() => handleQuickChip("What do I need to prepare for my meeting?")}
              >
                <span className="chip-icon">📋</span>
                <div>
                  <strong>Meeting Preparation</strong>
                  <span>Check required documents and details</span>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="messages-scroll-area">
            {messages.map((msg, index) => {
              const isLatestAgent = msg.role === 'agent' && index === messages.length - 1;
              const showBookingWidget = isLatestAgent && (sessionVariables?.bookingCode || secureLink || sessionVariables?.selectedSlot);

              return (
                <div 
                  key={index} 
                  className={`chat-bubble-row ${msg.role === 'agent' ? 'row-agent' : 'row-user'}`}
                >
                  <div className="avatar-circle">
                    {msg.role === 'agent' ? "🤖" : "👤"}
                  </div>

                  <div className="bubble-content-col">
                    <div className="bubble-metadata">
                      <span className="sender-name">{msg.role === 'agent' ? "Advisor AI" : "You"}</span>
                      {msg.inputType && (
                        <span className="input-type-tag">
                          {msg.inputType === 'voice' ? "🎙️ Spoken" : "⌨️ Typed"}
                        </span>
                      )}
                      {msg.timestamp && <span className="time-tag">{msg.timestamp}</span>}
                    </div>

                    <div className={`message-bubble ${msg.role === 'agent' ? 'bubble-agent' : 'bubble-user'} ${msg.complianceBlocked ? 'bubble-blocked' : ''}`}>
                      {msg.complianceBlocked && (
                        <div className="pii-blocked-banner">
                          🛡️ PII Guard Activated: Financial Data Masked
                        </div>
                      )}
                      <p>{msg.text}</p>
                    </div>

                    {/* EMBEDDED SPECIAL BOOKING WIDGET INSIDE CHAT FEED */}
                    {showBookingWidget && (
                      <div className="embedded-booking-card">
                        <div className="card-top-header">
                          <span className="card-badge-icon">🔒</span>
                          <div>
                            <h4>Appointment Slot Reserved ({sessionVariables?.mcpStatus || "Tentative"})</h4>
                            <span className="ref-code-label">Ref Code: <strong>{sessionVariables?.bookingCode || "AA-XXXX"}</strong></span>
                          </div>
                        </div>

                        <div className="card-details-grid">
                          <div className="detail-item">
                            <span className="d-label">Topic</span>
                            <span className="d-val">{sessionVariables?.topic || "Consultation"}</span>
                          </div>
                          <div className="detail-item">
                            <span className="d-label">Preferred Day</span>
                            <span className="d-val">{sessionVariables?.preferredDay || "Flexible"}</span>
                          </div>
                          <div className="detail-item">
                            <span className="d-label">Time Band</span>
                            <span className="d-val">{sessionVariables?.preferredTime || "Flexible"}</span>
                          </div>
                          <div className="detail-item">
                            <span className="d-label">Assigned Slot</span>
                            <span className="d-val highlight-slot">{sessionVariables?.selectedSlot || "Pending selection..."}</span>
                          </div>
                        </div>

                        <div className="card-actions-row">
                          <button 
                            className="secure-complete-btn"
                            onClick={() => {
                              if (sessionVariables?.bookingCode) {
                                setFormBookingCode(sessionVariables.bookingCode);
                              } else if (!formBookingCode) {
                                const lastAgentMsg = [...messages].reverse().find(m => m.role === 'agent' && m.text.match(/[A-Z]{2}-\d{4}/));
                                if (lastAgentMsg) {
                                  const match = lastAgentMsg.text.match(/[A-Z]{2}-\d{4}/);
                                  if (match) setFormBookingCode(match[0]);
                                }
                              }
                              setShowCompleteForm(true);
                            }}
                          >
                            <span>Verify &amp; Complete Contact Details</span>
                            <span className="arrow">↗</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </main>

      {/* FLOATING WAVEFORM BAR (Active during Voice or Audio Playback) */}
      {(isCalling || isPlaying) && (
        <div className="floating-waveform-wrapper">
          <Waveform 
            isActive={isCalling && !isPlaying} 
            isPlaying={isPlaying} 
            stateText={interimText ? `🎙️ Hearing: "${interimText}"...` : undefined}
          />
        </div>
      )}

      {/* UNIFIED CHATGPT-STYLE BOTTOM INPUT BAR */}
      <footer className="bottom-bar-wrapper">
        <div className="bottom-input-bar">
          <input 
            type="text" 
            className="chat-text-input"
            placeholder={isCalling ? "Voice mode active (or type extra details here)..." : "Ask to schedule an appointment or tap the mic..."}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSendMessage();
              }
            }}
          />

          <div className="bar-actions-right">
            {inputText.trim() ? (
              <button 
                type="button" 
                className="send-text-btn"
                onClick={() => handleSendMessage()}
                title="Send Message"
              >
                <span>↑</span>
              </button>
            ) : null}

            <button 
              type="button" 
              className={`voice-mic-btn ${isCalling ? 'calling active-red' : 'idle'}`}
              onClick={isCalling ? stopCall : startCall}
              title={isCalling ? "Stop Voice Mode" : "Activate Live Voice Assistant"}
            >
              <span className="mic-icon">{isCalling ? "⏹️" : "🎤"}</span>
              <span className="mic-label">{isCalling ? "Stop" : "Voice"}</span>
            </button>
          </div>
        </div>

      </footer>

      {/* SECURE COMPLIANCE VERIFICATION MODAL OVERLAY */}
      {showCompleteForm && (
        <div className="verification-modal-overlay">
          <div className="verification-modal-card">
            <button 
              type="button" 
              className="modal-close-btn"
              onClick={() => {
                setShowCompleteForm(false);
                setFormSuccess(false);
                setFormName("");
                setFormEmail("");
                setFormPhone("");
                setFormNotes("");
              }}
            >
              ✕
            </button>

            {!formSuccess ? (
              <form onSubmit={handleCompleteBooking} className="verification-form">
                <div className="form-header">
                  <span className="secure-shield-icon">🛡️</span>
                  <h3>Secure Client Onboarding</h3>
                  <p>Complete verification for Booking Code: <strong>{formBookingCode}</strong></p>
                </div>

                <div className="form-group">
                  <label htmlFor="booking_code">Booking Reference Code *</label>
                  <input 
                    type="text" 
                    id="booking_code" 
                    value={formBookingCode} 
                    onChange={e => setFormBookingCode(e.target.value)}
                    required
                    placeholder="e.g. GN-9127"
                    className="booking-code-input"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="full_name">Full Name *</label>
                  <input 
                    type="text" 
                    id="full_name" 
                    value={formName} 
                    onChange={e => setFormName(e.target.value)} 
                    required 
                    placeholder="John Doe"
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="email_addr">Email Address *</label>
                  <input 
                    type="email" 
                    id="email_addr" 
                    value={formEmail} 
                    onChange={e => setFormEmail(e.target.value)} 
                    required 
                    placeholder="john.doe@example.com"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="phone_num">Phone Number *</label>
                  <input 
                    type="tel" 
                    id="phone_num" 
                    value={formPhone} 
                    onChange={e => setFormPhone(e.target.value)} 
                    required 
                    placeholder="+91 XXXXX XXXXX"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="notes_text">Additional Consultation Notes (Optional)</label>
                  <textarea 
                    id="notes_text" 
                    value={formNotes} 
                    onChange={e => setFormNotes(e.target.value)} 
                    placeholder="Specify target timeline or financial goals..."
                    rows={3}
                  />
                </div>

                <button 
                  type="submit" 
                  className="modal-submit-btn" 
                  disabled={formSubmitting}
                >
                  {formSubmitting ? "Syncing Google Systems..." : "Verify & Lock Appointment"}
                </button>
              </form>
            ) : (
              <div className="verification-success-view">
                <div className="success-circle">✓</div>
                <h3>Consultation Confirmed!</h3>
                <p>Thank you, {formName || "Valued Client"}. Your financial advisory session is officially booked and locked.</p>
                
                <div className="client-receipt-card">
                  <div className="receipt-header">
                    <span>Booking Reference</span>
                    <strong className="receipt-code">{formBookingCode || sessionVariables?.bookingCode || "CONFIRMED"}</strong>
                  </div>
                  <div className="receipt-divider"></div>
                  <div className="receipt-row">
                    <span>Topic</span>
                    <strong>{sessionVariables?.topic || "Financial Advisory Consultation"}</strong>
                  </div>
                  <div className="receipt-row">
                    <span>Date & Time</span>
                    <strong>{sessionVariables?.preferredDay || "Scheduled Date"} at {sessionVariables?.selectedSlot || "Selected Time"} IST</strong>
                  </div>
                  {formEmail && (
                    <div className="receipt-row">
                      <span>Confirmation Email</span>
                      <strong>{formEmail}</strong>
                    </div>
                  )}
                </div>

                <div className="client-next-steps">
                  <div className="step-item">
                    <span className="step-icon">📅</span>
                    <div>
                      <strong>Calendar Hold Finalized</strong>
                      <span>A meeting invitation with video link has been scheduled on your calendar.</span>
                    </div>
                  </div>
                  <div className="step-item">
                    <span className="step-icon">✉️</span>
                    <div>
                      <strong>Confirmation Dispatched</strong>
                      <span>We sent your official booking receipt and advisor details to your inbox.</span>
                    </div>
                  </div>
                </div>

                <button 
                  type="button" 
                  className="modal-success-close-btn"
                  onClick={() => {
                    setShowCompleteForm(false);
                    setFormSuccess(false);
                    setFormName("");
                    setFormEmail("");
                    setFormPhone("");
                    setFormNotes("");
                  }}
                >
                  Done & Return to Dashboard
                </button>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
