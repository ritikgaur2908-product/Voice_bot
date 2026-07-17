import React from 'react';

interface WaveformProps {
  isActive: boolean;    // Mic is recording (User speaking/listening)
  isPlaying: boolean;   // AI is speaking (TTS playing)
  stateText?: string;   // Optional state label (e.g., "Listening...", "Speaking...")
}

export const Waveform: React.FC<WaveformProps> = ({ isActive, isPlaying, stateText }) => {
  const barsCount = 20;
  const bars = Array.from({ length: barsCount });

  const getStatusLabel = () => {
    if (stateText) return stateText;
    if (isPlaying) return "🔊 Advisor AI is speaking...";
    if (isActive) return "🎙️ Listening to you... (Speak naturally)";
    return "💡 Ready for your voice or typed request";
  };

  return (
    <div className={`modern-waveform-wrapper ${isPlaying ? 'ai-speaking' : isActive ? 'user-listening' : 'idle'}`}>
      <div className="waveform-status-pill">
        <span className="status-dot"></span>
        <span className="status-text">{getStatusLabel()}</span>
      </div>

      <div className="waveform-bars-container">
        {bars.map((_, i) => {
          // Create a wave shape curve for visual variance
          const middle = barsCount / 2;
          const distFromCenter = Math.abs(i - middle);
          const maxScale = Math.max(0.3, 1 - distFromCenter * 0.08);

          return (
            <div
              key={i}
              className="waveform-bar-item"
              style={{
                animationDelay: `${(i * 0.06).toFixed(2)}s`,
                '--scale-factor': maxScale,
              } as React.CSSProperties}
            />
          );
        })}
      </div>
    </div>
  );
};
