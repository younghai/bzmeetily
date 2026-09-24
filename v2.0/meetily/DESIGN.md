## macOS window controls — 2026-09-24
macOS can replace the native red/yellow/green traffic lights with its purple screen-sharing indicator while this window is shared. Keep the native title bar. The app also shows a compact, keyboard-labeled close/minimize/full-screen toolbar at the upper left of the webview, below the native title bar. Reserve vertical space before the collapsed and expanded sidebar content and horizontal space before the interpretation dialog title so this toolbar does not cover app controls or text. Use the existing white/slate/blue control tokens. This toolbar appears only in the native Tauri app; localhost keeps its browser controls.

## Expanded conversation view — 2026-09-14
The latest user request prefers much larger Japanese-left/Korean-right panes and a longer continuous conversation flow. Interpretation fills the browser viewport without a max-width card or outside gutters. Native startup uses a maximized resizable window. Compact controls leave more vertical space for text. Each recognized speech turn, including a turn still being revised, has its own timestamped paragraph and timeline card; their order, Japanese source, Korean translations, errors and pending state remain intact. Each language scrolls independently. New output follows the bottom unless the reader has scrolled up.

# Meetily local workspace design

## 1. Existing reference

Reuse Meetily's existing white/light-gray operational UI, compact navigation, red recording action, blue selection, gray bordered controls, Lucide icons, and existing component library. The task adds functional browser and interpretation surfaces, not a rebrand. Sources: frontend/src/app/globals.css, frontend/tailwind.config.js, frontend/src/components/ui, and the installed v0.4.1 screen.

## 2. Tokens

Surfaces white #ffffff, workspace #f8fafc; text #111827, secondary #475569, muted #64748b; border #e2e8f0; primary #2563eb; recording/error #dc2626; success #15803d. Source Japanese panel white, translated Korean panel #eff6ff. Radius 8px controls, 12px panels. Spacing 4/8/12/16/24/32px. System font stack with Apple SD Gothic Neo and Hiragino Sans fallbacks. Type scale 12/14/16/20/24/28px, line height 1.5–1.7 for CJK.

## 3. Layout

Desktop: 256px meeting sidebar, fluid main workspace, paired source/translation transcript and summary below. 768px: compact sidebar toggle and stacked controls. 375px: single column, wrapped actions, full-width dialogs, no horizontal page scrolling. Avoid empty decorative cards and oversized hero copy.

## 4. States and motion

Idle, requesting microphone, recording, draining pending segments, stopped, importing, summarizing, service unavailable, input denied, and recoverable error are explicit. Stop stops the physical tracks immediately and then drains queued audio. Record control is red only during active capture. Keep transcript entries stable and chronological; do not scroll away from manually reviewed older text. Transitions 150ms opacity/color, respect prefers-reduced-motion.

## 5. Primitives

Reuse button, labeled native select, text input, status badge, meeting list button, transcript row, empty state, visible error banner, and progress indicator. All controls have accessible names; icons are decorative within labeled controls. Source and translation have explicit JA/KO labels and optional timestamps.

## 6. Accessibility

Keyboard-driven controls and visible focus ring, 44px minimum key actions, contrast >= 4.5:1 for text, live status polite announcements only (avoid reading every full transcript continuously), lang=ja and lang=ko on content, disabled states explained, no color-only state. A Japanese-speaking participant and Korean-speaking listener are the main users.

## 7. Data and content

Use real transcripts/results. No demo content appears as recorded data. Test fixtures are explicitly labeled. Show local service readiness, source type, language direction, pending segment count and error/retry actions. Retain Japanese originals when translation fails. Optional speech is off by default and limited to local Korean voices; avoid microphone/speaker feedback.

## 8. Accepted constraints and verification

Browser system/tab audio availability depends on selected capture surface and browser. Mobile microphone behavior and physical hardware capture require explicit runtime evidence; synthetic audio tests do not establish real meeting quality. No new React telemetry/dev-tool dependencies are added because workspace instructions prohibit new dependencies without an explicit request. Browser capture, import, save/reload, summaries, translations, and stop/error states require real surface checks and independent review.

## Interpretation view

The user requested Japanese in the left pane and Korean in the right pane when opening interpretation. Both browser and desktop now use a shared full-screen dialog. Language headers remain visible; each pane scrolls vertically. On narrow screens the implementation preserves readable columns inside a horizontal scroll container; this is an implementation choice, not an explicit user approval of mobile scrolling. The main workspace retains its ordinary responsive single-column layout without page overflow.
# Mode-first entry (2026-09-14)

Home begins with two explicit choices. 실시간 통역 is the primary blue card; 회의 녹음 is a neutral card. Neither choice starts capture. The interpretation view opens idle and uses an explicit 통역 시작 / 통역 중지 action. Its fixed header includes a three-step 일본어 음성 → 일본어 전사 → 한국어 통역 guide, audio source/status, and controls above the existing Japanese-left/Korean-right panes. Keep 44 px control targets and an accessible focus cycle including header controls. While capture or final processing is active, prevent closing the view; stop is always available while capturing. Once stopped, captions remain readable. Both browser and native live interpretation use temporary in-memory audio and captions, with no meeting/audio/transcript recovery record. Default input is computer audio plus microphone. Live captions must update before Stop, including short Whisper chunks marked partial. Browser sends 2-second audio windows; native live VAD must bound long continuous speech to short windows. Existing recording/import/history remains behind 회의 녹음.

## Contextual live revisions and recovery — 2026-09-15
Browser live recognition now updates the same utterance while speech arrives, retaining preceding audio in memory until a short pause or bounded window. A small status note explains that captions may be corrected while the speaker continues. When Japanese text changes, clear the Korean translation of that same turn until its matching revision arrives; keep earlier completed turns visible. Failed translation retains the Japanese text and presents a keyboard-accessible `다시 통역` action next to its error, using existing 44px bordered error-button tokens. No new visual palette/layout is introduced. The earlier fixed two-second browser window description is superseded; meeting recording stays unchanged.

## Conversation timeline — 2026-09-24
The full-screen interpretation view shows a horizontal time-ordered strip above the Japanese and Korean panes. Each recognized speech turn has its own card, timestamp, and two-line source/translation preview. Selecting one highlights its card, scrolls both panes to that turn, and pauses automatic following. `처음 대화` jumps to the oldest turn; `최근 대화` resumes following new captions. A pending translation never removes the original or a completed earlier turn. The strip reuses the existing blue, white, and slate tokens and keeps the two reading panes large. Earlier six-turn grouping hid short meetings behind one card and is superseded.
