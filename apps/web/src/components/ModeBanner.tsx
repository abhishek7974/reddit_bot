import type { AppMode } from '@careerconnect/shared';

/** Mode + kill-switch banners shown at the top of every page. */
export function ModeBanner({
  mode,
  globalPause,
  pauseReason,
}: {
  mode: AppMode | null | undefined;
  globalPause: boolean | null | undefined;
  pauseReason?: string | null;
}) {
  return (
    <>
      {mode === 'DEMO' ? (
        <div className="border-b border-fuchsia-300 bg-fuchsia-100 px-4 py-2 text-center text-sm font-semibold text-fuchsia-950" role="note">
          Demo mode — synthetic data, nothing is sent to Reddit
        </div>
      ) : null}
      {mode === 'DRAFT_ONLY' ? (
        <div className="border-b border-sky-300 bg-sky-100 px-4 py-2 text-center text-sm font-semibold text-sky-950" role="note">
          Draft-only — publishing disabled
        </div>
      ) : null}
      {globalPause ? (
        <div className="border-b border-red-400 bg-red-700 px-4 py-2 text-center text-sm font-bold uppercase tracking-wide text-white" role="alert">
          Publishing paused
          {pauseReason ? <span className="ml-2 font-normal normal-case tracking-normal">— {pauseReason}</span> : null}
        </div>
      ) : null}
    </>
  );
}
