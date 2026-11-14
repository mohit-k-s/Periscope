import React, { useEffect, useState } from 'react';

interface InitialSplashScreenProps {
  isReady: boolean;
  statusMessage?: string;
  theme?: 'dark' | 'light';
  onDismiss: () => void;
}

export const InitialSplashScreen: React.FC<InitialSplashScreenProps> = ({
  isReady,
  statusMessage = 'Discovering RDS Database Fleet...',
  theme = 'dark',
  onDismiss,
}) => {
  const [phase, setPhase] = useState<'centered' | 'docking' | 'done'>('centered');
  const [targetRect, setTargetRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    if (isReady && phase === 'centered') {
      // Find the Header logo's actual rendered position
      const headerLogo = document.getElementById('header-brand-logo');
      if (headerLogo) {
        const rect = headerLogo.getBoundingClientRect();
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      } else {
        // Fallback approximate position of the header logo
        setTargetRect({
          top: 12,
          left: 16,
          width: 44,
          height: 36,
        });
      }

      // Small tick to ensure browser calculates layout before starting CSS transition
      const timer = setTimeout(() => {
        setPhase('docking');
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [isReady, phase]);

  useEffect(() => {
    if (phase === 'docking') {
      const finishTimer = setTimeout(() => {
        setPhase('done');
        onDismiss();
      }, 750);
      return () => clearTimeout(finishTimer);
    }
  }, [phase, onDismiss]);

  if (phase === 'done') return null;

  const isDocking = phase === 'docking';
  const logoSrc = theme === 'dark' ? '/icon-dark.png' : '/icon-light.png';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center pointer-events-none ${
        isDocking ? '' : 'pointer-events-auto'
      }`}
    >
      {/* Background Drawing-Board Canvas Overlay (Fades out when docking begins) */}
      <div
        className={`absolute inset-0 transition-opacity duration-700 ease-out ${
          isDocking ? 'opacity-0' : 'opacity-100'
        } ${
          theme === 'dark'
            ? 'bg-[#121316] text-white'
            : 'bg-[#fdfcf9] text-stone-900'
        }`}
        style={{
          backgroundImage:
            theme === 'dark'
              ? 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)'
              : 'radial-gradient(rgba(0,0,0,0.05) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Floating Animated Logo (Transitions from Viewport Center directly to Top-Left Header) */}
      <div
        className="fixed z-50 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] flex items-center justify-center"
        style={
          isDocking && targetRect
            ? {
                top: `${targetRect.top}px`,
                left: `${targetRect.left}px`,
                width: `${targetRect.width}px`,
                height: `${targetRect.height}px`,
                transform: 'none',
              }
            : {
                top: '42%',
                left: '50%',
                width: '80px',
                height: '80px',
                transform: 'translate(-50%, -50%)',
              }
        }
      >
        <img
          src={logoSrc}
          alt="Periscope Logo"
          className={`w-full h-full object-contain rounded-xl shadow-2xl transition-all duration-700 border ${
            theme === 'dark'
              ? 'border-zinc-700 bg-zinc-900/90 shadow-amber-500/10'
              : 'border-stone-300 bg-white/90 shadow-stone-400/20'
          } p-1.5`}
        />
      </div>

      {/* Centered Welcome & Loading Indicator Text (Fades out quickly upon ready) */}
      <div
        className={`relative z-10 flex flex-col items-center text-center max-w-sm px-6 mt-32 transition-all duration-300 ${
          isDocking ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono font-extrabold text-2xl tracking-widest text-stone-900 dark:text-white uppercase">
            Periscope
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            v1.0
          </span>
        </div>
        <p className="text-xs font-mono text-stone-500 dark:text-zinc-400 mb-6">
          Architectural RDS Telemetry & Snapshot Vault
        </p>

        {/* Dynamic Architectural Progress Line */}
        <div className="w-56 h-1 bg-stone-200 dark:bg-zinc-800 rounded-full overflow-hidden mb-3 relative">
          <div className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-400 rounded-full animate-[pulse_1.2s_ease-in-out_infinite] w-3/4" />
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-stone-600 dark:text-zinc-300">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping inline-block" />
          <span>{statusMessage}</span>
        </div>
      </div>
    </div>
  );
};
