import { ChevronLeft, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useRecorderStore } from "./recorder-store";
import { RecordingTranscript } from "./recording-transcript-panel";

/** Full-page detail for the global Recorder and project overview. */
export function RecordingTranscriptPage(props: {
  recordingId: string;
  backLabel: string;
  onBack: () => void;
}) {
  const recording = useRecorderStore(state => state.recording);
  const finalizing = useRecorderStore(state => state.finalizing);
  const stop = useRecorderStore(state => state.stopRecording);
  const isRecording = recording?.id === props.recordingId && !recording.ephemeral;

  return <div className="lw-recorder h-full w-full">
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1200px] flex-col py-6">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          <ChevronLeft data-icon="inline-start" />{props.backLabel}
        </Button>
        <div className="flex items-center gap-2">
          {isRecording ? <Button size="sm" disabled={finalizing} onClick={() => void stop()}>
            {finalizing ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Square data-icon="inline-start" />}
            {t(finalizing ? "recorder.finishing" : "recorder.stop")}
          </Button> : null}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <RecordingTranscript key={props.recordingId} recordingId={props.recordingId} />
      </div>
    </div>
  </div>;
}
