import { useNavigate } from "react-router-dom"
import { Player } from "@remotion/player"
import { motion } from "framer-motion"
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion"

// ─── Remotion hero composition ───

const CHAT_MESSAGE = "Build me GitHub OAuth login."

const DEMO_TASKS = [
  { id: 1, title: "Set up OAuth provider config", agent: "backend", color: "#22C55E" },
  { id: 2, title: "Create login callback route", agent: "backend", color: "#22C55E" },
  { id: 3, title: "Add GitHub sign-in button", agent: "frontend", color: "#8C8980" },
]

const TYPING_START = 20
const TYPING_END = 80
const SENT_AT = 85
const TASKS_START = 100
const TASK_STAGGER = 12
const IN_PROGRESS_AT = 150
const TOTAL_FRAMES = 270

function HeroDemoComposition() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const typedRatio = interpolate(frame, [TYPING_START, TYPING_END], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.linear,
  })
  const charsTyped = Math.floor(typedRatio * CHAT_MESSAGE.length)
  const isTyping = frame >= TYPING_START && frame < SENT_AT
  const isSent = frame >= SENT_AT

  const cursorVisible = isTyping && Math.floor(frame / 8) % 2 === 0

  const sentSpring = spring({ frame: frame - SENT_AT, fps, config: { damping: 15, stiffness: 120 } })
  const sentOpacity = isSent ? interpolate(sentSpring, [0, 1], [0, 1]) : 0
  const sentY = isSent ? interpolate(sentSpring, [0, 1], [10, 0]) : 10

  const taskSprings = DEMO_TASKS.map((_, i) => {
    const taskFrame = TASKS_START + i * TASK_STAGGER
    if (frame < taskFrame) return { opacity: 0, y: 14, scale: 0.97 }
    const s = spring({ frame: frame - taskFrame, fps, config: { damping: 14, stiffness: 100 } })
    return {
      opacity: interpolate(s, [0, 1], [0, 1]),
      y: interpolate(s, [0, 1], [14, 0]),
      scale: interpolate(s, [0, 1], [0.97, 1]),
    }
  })

  const isInProgress = frame >= IN_PROGRESS_AT
  const progressSpring = isInProgress
    ? spring({ frame: frame - IN_PROGRESS_AT, fps, config: { damping: 12, stiffness: 100 } })
    : 0
  const dotScale = interpolate(progressSpring, [0, 1], [0, 1])
  const dotPulse = isInProgress ? 0.5 + 0.5 * Math.sin((frame - IN_PROGRESS_AT) * 0.15) : 0

  const FG = "#1A1916"
  const MUTED = "#8C8980"
  const BORDER = "#E2E0DA"
  const BG = "#F7F6F2"
  const CARD = "#FFFFFF"
  const GREEN = "#22C55E"

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG,
        fontFamily: "'Instrument Sans', system-ui, sans-serif",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "10px 16px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#EF4444" }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#F59E0B" }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22C55E" }} />
        <span style={{ marginLeft: 10, fontSize: 11, color: MUTED, letterSpacing: "0.5px" }}>
          peon.work
        </span>
      </div>

      {/* Split */}
      <div style={{ display: "flex", flex: 1 }}>
        {/* Left: Chat */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            padding: 20,
            borderRight: `1px solid ${BORDER}`,
          }}
        >
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 2,
              color: MUTED,
              marginBottom: 14,
              fontWeight: 500,
            }}
          >
            Chat
          </div>

          {isSent && (
            <div style={{ opacity: sentOpacity, transform: `translateY(${sentY}px)`, marginBottom: 14 }}>
              <div
                style={{
                  display: "inline-block",
                  background: FG,
                  borderRadius: 4,
                  padding: "9px 13px",
                  fontSize: 13,
                  color: "#F7F6F2",
                }}
              >
                {CHAT_MESSAGE}
              </div>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: `1px solid ${BORDER}`,
              borderRadius: 4,
              padding: "9px 13px",
              gap: 8,
              background: CARD,
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: 13,
                color: isTyping ? FG : MUTED,
                minHeight: 20,
                display: "flex",
                alignItems: "center",
              }}
            >
              {isTyping ? (
                <>
                  {CHAT_MESSAGE.slice(0, charsTyped)}
                  <span
                    style={{
                      display: "inline-block",
                      width: 2,
                      height: 15,
                      background: cursorVisible ? FG : "transparent",
                      marginLeft: 1,
                    }}
                  />
                </>
              ) : (
                "Message your team..."
              )}
            </span>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 3,
                fontWeight: 500,
                background: isTyping && charsTyped >= CHAT_MESSAGE.length ? FG : BORDER,
                color: isTyping && charsTyped >= CHAT_MESSAGE.length ? "#F7F6F2" : MUTED,
              }}
            >
              Send
            </span>
          </div>
        </div>

        {/* Right: Board */}
        <div style={{ flex: 1, padding: 20 }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 2, color: MUTED, fontWeight: 500 }}>
              {isInProgress ? "Board" : "To Do"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {DEMO_TASKS.map((task, i) => {
              const s = taskSprings[i]
              const isActive = isInProgress && task.id === 1
              return (
                <div
                  key={task.id}
                  style={{
                    opacity: s.opacity,
                    transform: `translateY(${s.y}px) scale(${s.scale})`,
                    border: `1px solid ${isActive ? GREEN : BORDER}`,
                    borderLeft: isActive ? `3px solid ${GREEN}` : `1px solid ${BORDER}`,
                    background: CARD,
                    borderRadius: 4,
                    padding: "8px 12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {isActive && (
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: `rgba(34,197,94,${0.6 + dotPulse * 0.4})`,
                          transform: `scale(${dotScale})`,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span style={{ fontSize: 13, color: FG, lineHeight: 1.3, fontWeight: 500 }}>
                      {task.title}
                    </span>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: MUTED, fontFamily: "'JetBrains Mono', monospace" }}>
                      {task.agent}
                    </span>
                    {isActive && (
                      <span style={{ fontSize: 9, color: GREEN, marginLeft: 8, textTransform: "uppercase", letterSpacing: 1, fontWeight: 500 }}>
                        In Progress
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            {frame < TASKS_START && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 100, fontSize: 12, color: MUTED }}>
                No tasks yet
              </div>
            )}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}

// ─── Truths ───

const TRUTHS = [
  {
    number: "01",
    title: "A full team, not a single bot.",
    body: "Lead, backend, frontend, QA — each with a role, each with context, working together.",
  },
  {
    number: "02",
    title: "You see everything.",
    body: "Every file edit. Every test run. Every decision. The board shows what the team is doing right now.",
  },
  {
    number: "03",
    title: "You stay in charge.",
    body: "Talk to your team in plain language. Redirect. Reprioritize. They listen.",
  },
]

// ─── Page ───

const ease = [0.25, 0.1, 0.25, 1] as const

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/10">
      {/* Nav */}
      <header className="px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-semibold tracking-tight text-base">
            peon.work
          </span>
          <button
            onClick={() => navigate("/login")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            Sign in
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 pt-24 sm:pt-36 pb-16 sm:pb-24">
        <div className="max-w-5xl mx-auto">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease }}
            className="font-serif text-[clamp(3rem,8vw,6rem)] font-normal tracking-[-0.035em] leading-[0.95] max-w-4xl italic"
          >
            While you sleep,
            <br />
            your team ships.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25, ease }}
            className="mt-8 text-lg sm:text-xl text-muted-foreground max-w-xl leading-relaxed"
          >
            Peon launches a team of AI agents on your codebase. You direct.
            They build. The board shows everything.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5, ease }}
            className="mt-10 flex flex-col sm:flex-row items-start gap-4"
          >
            <button
              onClick={() => navigate("/login")}
              className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-7 py-3.5 rounded-sm text-[15px] font-medium hover:bg-primary/85 transition-colors cursor-pointer"
            >
              Launch your team
              <span className="inline-block transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </button>
            <span className="text-sm text-muted-foreground sm:pt-3.5">
              Bring your own key. No subscription.
            </span>
          </motion.div>
        </div>
      </section>

      {/* Hero demo — Remotion Player */}
      <section className="px-6 pb-28 sm:pb-36">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.7, ease }}
          className="max-w-3xl mx-auto rounded-sm overflow-hidden border border-border"
        >
          <Player
            component={HeroDemoComposition}
            durationInFrames={TOTAL_FRAMES}
            fps={30}
            compositionWidth={720}
            compositionHeight={400}
            loop
            autoPlay
            style={{ width: "100%" }}
          />
        </motion.div>
      </section>

      {/* Three truths */}
      <section className="px-6 pb-28 sm:pb-36">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-16 md:gap-12">
            {TRUTHS.map((truth, i) => (
              <motion.div
                key={truth.number}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.6, delay: i * 0.12, ease }}
              >
                <span className="text-[64px] sm:text-[80px] font-bold leading-none tracking-[-0.04em] text-foreground/[0.06]">
                  {truth.number}
                </span>
                <h3 className="mt-2 text-xl sm:text-2xl font-semibold tracking-[-0.02em]">
                  {truth.title}
                </h3>
                <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed">
                  {truth.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it starts */}
      <section className="px-6 pb-28 sm:pb-36">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="border-t border-border pt-20"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
              {[
                "Connect your repo and API key.",
                "Describe what you want built.",
                "Watch the board.",
              ].map((step, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.5, delay: i * 0.1, ease }}
                >
                  <span className="text-sm font-mono text-muted-foreground">
                    {i + 1}
                  </span>
                  <p className="mt-2 text-lg leading-relaxed">
                    {step}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-6 pb-28 sm:pb-36">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, ease }}
          >
            <h2 className="font-serif text-[clamp(2rem,5vw,3.5rem)] font-normal tracking-[-0.03em] leading-[1.05] italic">
              Stop building alone.
            </h2>
            <div className="mt-10">
              <button
                onClick={() => navigate("/login")}
                className="group inline-flex items-center gap-2 bg-primary text-primary-foreground px-7 py-3.5 rounded-sm text-[15px] font-medium hover:bg-primary/85 transition-colors cursor-pointer"
              >
                Launch your team
                <span className="inline-block transition-transform group-hover:translate-x-0.5">
                  →
                </span>
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-10 border-t border-border">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">peon.work</span>
          <span className="text-xs text-muted-foreground/60">
            Bring your own Anthropic key. Your data, your models.
          </span>
        </div>
      </footer>
    </div>
  )
}
