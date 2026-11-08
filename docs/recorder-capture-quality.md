# Recorder: app audio, speaker identification, and transcription quality

This covers three parts of the local Recorder pipeline: per-application audio
capture on macOS, on-device speaker diarization, and the audio front-end that
feeds the ASR model. All processing stays on the device.

## Finding recordings from chat

`legalwork_recordings_list` searches the retained recordings in the current
desktop profile, including global recordings and every project's recordings.
It supports optional project, title, and inclusive local-date filters, plus
`scope: "global"` for unassigned recordings only. Discovery returns metadata,
not transcript excerpts or speaker names.
Use `period: "yesterday"` or `"today"` to resolve relative dates with the host's
clock and time zone. Follow `nextCursor` to exhaust a list; later pages retain
the initial date filters and exclude newly created recordings.

`legalwork_recording_read` reads the current transcript by recording ID, with
timestamps and saved speaker names. It includes finalized live speech and
supports `nextOffset` pagination for long transcripts. Refresh from offset zero
after edits. Temporary dictation captures and internal storage paths are excluded.

The library routes require owner access, inherited from the authenticated chat.
Collaborators, viewers, unknown sessions, and revoked sessions cannot inspect
the owner's private library. Interactive chats can read global and current-project
transcripts directly. Another project's transcript requires an existing project
or folder grant, or explicit read-only recording approval in that chat. Approval
does not grant access to other files and expires on restart. Permission, session
scope, and project-root changes invalidate stale approvals.

Scheduled tasks use the server-recorded project scope from their saved settings:
`project` includes that project plus unassigned global recordings; `all` includes
every project plus global recordings. Both discovery and content reads enforce
this scope. A scheduled run cannot expand access through tool arguments or an
interactive approval, and verified descendant chats inherit the same restriction.
Headless servers report that the library is unavailable,
not that it is empty. Other devices and external cloud libraries are not searched.

Verified on 21 October 2026 with the standard development profile: the same chat
that previously found only one project recording returned all 15 library entries
for the previous day, then read a global recording with corrected speaker names.
Automated coverage includes local midnight, daylight saving transitions,
pagination, transcript edits, partial/live speech, cross-project approvals,
existing grants, scheduled project boundaries, and permission downgrades.

## Capture sources

The Recorder captures the **microphone** and **system audio** (everything the
machine plays). System audio uses Chromium's WASAPI loopback on Windows and a
Core Audio / ScreenCaptureKit path on macOS 13+, gated by the macOS **Screen &
System Audio Recording** permission.

Per-application capture (a picker that taps one chosen app) was removed:
single-app Core Audio process taps were unreliable for the multiprocess apps
users actually wanted (Chrome/Electron emit audio from helper processes, not
the main one). System audio captures the same content without the fragility.
The native tap backend remains in the tree, unused, in case per-app capture is
revisited.

## Speaker identification (diarization)

Speaker labels ("who said what") are **always on** for retained call/meeting
recordings — there is no setting. The two on-device models (pyannote
segmentation 3.0 + a 3D-Speaker CAM++ embedding extractor, ~36 MB total)
download automatically in the background the first time the recorder loads (and
retry on each load until installed). Recordings made before that download
finishes simply aren't labeled; later ones are.

How it works: each completed VAD speech segment (at most 18 seconds) is
processed locally while the recording continues. Segmentation isolates the
predominant voice; CAM++ produces its embedding. A recording-scoped matcher
compares that embedding with retained speaker centroids. The recording keeps
these identities across VAD boundaries and disk writes. Finalization drains
queued speech and writes exports.

The live matcher uses cosine similarity 0.5. The previous live-only 0.75 cutoff
fragmented natural speech: two manually grouped turns in a local test recording
scored 0.63. The diarizer's separate clustering threshold is a distance setting;
it is not interchangeable with this matching score.

At least one second of voiced audio is needed to recognize an existing speaker,
1.5 seconds to create a speaker, and two seconds to adapt a centroid. If the two
best matches are within 0.08, or no voice covers 65% of the segment's detected
speech, the segment remains unassigned. Only its dominant voice can create an
identity. Brief background voices do not silently seed additional centroids.

Limits: labels remain provisional. Similar voices can merge, and microphone or
channel changes can still split an identity. One label represents each transcript
segment, so balanced overlap remains unassigned. There is no whole-recording
speaker pass or one-hour limit; speaker state is bounded to 64 centroids.

## Transcription quality (front-end)

The dominant quality levers for the local ASR are the audio the model is fed,
not the model config:

- **Microphone front-end.** Chromium's automatic gain control, noise
  suppression, and echo cancellation are tuned for telephony, not ASR, and
  distort the waveform. For microphone-only capture all three are off. When
  system/app audio is also captured, echo cancellation is enabled (the speaker
  output can leak into the mic); gain control and noise suppression stay off.
- **Word-onset padding.** Voice activity detection cuts speech at the exact
  on/offset, clipping the first ~100–300 ms of a word so a transducer drops or
  garbles it. Each segment is decoded with ~300 ms of raw pre-roll and
  hangover from a rolling buffer; the reported timestamps still cover only the
  speech.
- **Mix limiting.** When several sources are summed (a call recording), the mix
  is trimmed and limited so two loud sources can't overshoot and hard-clip into
  distortion the model reads as noise. A single source is left untouched.

The Parakeet model config itself (int8 weights, `nemo_transducer`, greedy
decoding, 80-dim features) is correct and unchanged; int8 and the decoding
method were not the cause of poor quality, and `modified_beam_search` is
deliberately avoided (it hallucinates on Parakeet TDT).

## Model lineup (three tiers)

Lawyers don't read "whisper-small", so the catalog is presented as three
tiers with plain-English benefits (see
`apps/app/.../recorder/model-tiers.ts`):

| Tier | Model | Why |
|---|---|---|
| **Basic** | `whisper-tiny` | Fast rough notes, runs on any/old computer. |
| **Standard** | `whisper-small` | Balanced accuracy for modern computers (free). |
| **Premium** | `parakeet-tdt-0.6b-v3` | Best accuracy *and* real-time fast, with punctuation — entitlement-gated. |

On CPU (sherpa-onnx int8, the runtime here), Parakeet is both the fastest and
the most accurate model for German (~5% WER vs ~20% for whisper-small) and the
only premium model that runs live on ordinary laptops — so Premium leads with
it rather than Whisper Large Turbo (batch-only on CPU). Whisper Base and Turbo
were dropped.

**Device hint.** `RecorderService.deviceProfile()` reads `os.cpus()` /
`os.totalmem()` / `process.arch` and recommends Standard on Apple Silicon or
≥8 GB/≥4-core machines, else Basic. The recommended tier is badged
"Recommended for your device" and adopted as the default when the user hasn't
chosen one.

**Premium gating.** `isPremiumEntitled()` in `model-tiers.ts` is a placeholder
that returns `false` today (auth is built separately). While it is false, the
Premium tier shows a lock/badge and an "unlocks with your plan" dialog instead
of downloading, and the store refuses to select or download a premium model.
Wire that one function to the real entitlement when auth lands.

## Onboarding & first-run

- **First-run modal** (`shell/transcription-intro.tsx`): a one-time hero modal
  explaining on-device transcription, shown the first desktop launch after
  install (deferring if a "What's new" announcement is still pending).
- **Onboarding setup step** (`onboarding/transcription-setup-step.tsx`): the
  final onboarding cover offers two one-tap installs — add the Office add-ins
  and download the recommended transcription model. Both optional; both also
  live in Settings.
- **Settings › Recorder** is split into **Models** and **Dictate anywhere**
  tabs.

## Workspace transcripts and long recordings

Project-home recording actions open transcript tabs in the workspace. An active
recording linked to that project is shared with its visible chat automatically.
The Live call toggle can opt the workspace out for the rest of that recording.
Global recordings remain opt-in; attaching one opens its transcript beside chat.
The agent is notified once per chat and reads `live-call-transcript.md` on demand.
After a recording ends, speaker corrections and title changes also update this
managed workspace copy. The recording metadata retains its destination across
app restarts. A hidden sidecar identifies the file's recording, so editing an
older call cannot overwrite a newer call that has reused the same filename.
The Markdown stays plain and opens in the normal document view.
Copies disconnected before recording ends remain snapshots of what was shared;
later speech is not added to workspaces where sharing was turned off.

Compressed audio is streamed to `audio.webm` in one-second chunks. Each completed
speech segment is appended to `transcript.jsonl` immediately, and the workspace
mirror appends only new text in bounded batches. Stopping preserves the mirror
and appends its end marker. Final JSON, Markdown, text and SRT exports are written
once at completion. After an interruption, the journal recovers completed
segments, tolerating an incomplete final line, and marks the recording as
interrupted instead of presenting it as complete.

Speaker detection now runs on completed VAD segments (at most 18 seconds) while
recording. The installed segmentation and embedding models assign provisional
speaker IDs; up to 64 voice centroids keep IDs stable across segments. Short or
uncertain speech remains unassigned, and a segment containing multiple voices is
assigned to its dominant speaker. Saved transcripts support manual corrections.
There is no whole-recording PCM read or one-hour speaker limit. The worker keeps
its 30-second audio ring and at most one pending partial decode per stream.

Regression coverage feeds six hours of timestamped segments through persistence,
checks interruption recovery, and verifies that stopping keeps all live text.
This is not a six-hour capture soak test: available disk space and a transcription
model that keeps up with the input still determine practical recording length.
