'use client';

interface AutoPlayControlsProps {
  playing: boolean;
  progress: number;
  total: number;
  themeColor?: string;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function AutoPlayControls({
  playing,
  progress,
  total,
  themeColor = '#4FC3F7',
  onPlayPause,
  onPrev,
  onNext,
}: AutoPlayControlsProps) {
  const percent = total > 0 ? (progress / total) * 100 : 0;

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {/* Progress bar */}
      <div
        className="w-full h-[3px] bg-white/10 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-all duration-100"
          style={{ width: `${percent}%`, backgroundColor: themeColor }}
        />
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-center gap-1">
        <button
          className="p-1 rounded hover:bg-white/10 transition-colors"
          onClick={onPrev}
          title="Skip Previous"
          aria-label="Skip to previous"
        >
          <svg className="w-4 h-4 text-white/70" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>
        <button
          className="p-1.5 rounded-full hover:bg-white/10 transition-colors"
          onClick={onPlayPause}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button
          className="p-1 rounded hover:bg-white/10 transition-colors"
          onClick={onNext}
          title="Skip Next"
          aria-label="Skip to next"
        >
          <svg className="w-4 h-4 text-white/70" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
