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
  { id: 1, title: "Set up OAuth provider config", agent: "backend", color: "#34d399" },
  { id: 2, title: "Create login callback route", agent: "backend", color: "#34d399" },
  { id: 3, title: "Add GitHub sign-in button", agent: "frontend", color: "#38bdf8" },
]

// Timeline (in frames at 30fps):
// 0-20:    pause / idle
// 20-80:   typing the message (60 frames ≈ 2s)
// 80-95:   message sent, bubble appears
// 95-140:  task cards cascade in
// 140-200: first card goes "in progress"
// 200-270: hold / admire
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

  // How many chars are typed
  const typedRatio = interpolate(frame, [TYPING_START, TYPING_END], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.linear,
  })
  const charsTyped = Math.floor(typedRatio * CHAT_MESSAGE.length)
  const isTyping = frame >= TYPING_START && frame < SENT_AT
  const isSent = frame >= SENT_AT

  // Cursor blink
  const cursorVisible = isTyping && Math.floor(frame / 8) % 2 === 0

  // Sent bubble spring
  const sentSpring = spring({ frame: frame - SENT_AT, fps, config: { damping: 15, stiffness: 120 } })
  const sentOpacity = isSent ? interpolate(sentSpring, [0, 1], [0, 1]) : 0
  const sentY = isSent ? interpolate(sentSpring, [0, 1], [10, 0]) : 10

  // Task card springs
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

  // In-progress state
  const isInProgress = frame >= IN_PROGRESS_AT
  const progressSpring = isInProgress
    ? spring({ frame: frame - IN_PROGRESS_AT, fps, config: { damping: 12, stiffness: 100 } })
    : 0
  const dotScale = interpolate(progressSpring, [0, 1], [0, 1])
  // Pulse the dot
  const dotPulse = isInProgress
    ? 0.5 + 0.5 * Math.sin((frame - IN_PROGRESS_AT) * 0.15)
    : 0

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#111",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "10px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e" }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
        <span
          style={{
            marginLeft: 10,
            fontSize: 11,
            color: "rgba(255,255,255,0.22)",
            letterSpacing: "0.5px",
          }}
        >
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
            borderRight: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 2,
              color: "rgba(255,255,255,0.18)",
              marginBottom: 14,
            }}
          >
            Chat
          </div>

          {/* Sent bubble */}
          {isSent && (
            <div
              style={{
                opacity: sentOpacity,
                transform: `translateY(${sentY}px)`,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  background: "rgba(255,255,255,0.07)",
                  borderRadius: 8,
                  padding: "9px 13px",
                  fontSize: 13,
                  color: "rgba(255,255,255,0.65)",
                }}
              >
                {CHAT_MESSAGE}
              </div>
            </div>
          )}

          {/* Input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 8,
              padding: "9px 13px",
              gap: 8,
            }}
          >
            <span
              style={{
                flex: 1,
                fontSize: 13,
                color: isTyping ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.18)",
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
                      background: cursorVisible ? "rgba(255,255,255,0.55)" : "transparent",
                      marginLeft: 1,
                    }}
                  />
                </>
              ) : isSent ? (
                "Message your team..."
              ) : (
                "Message your team..."
              )}
            </span>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 4,
                background:
                  isTyping && charsTyped >= CHAT_MESSAGE.length
                    ? "rgba(255,255,255,0.12)"
                    : "rgba(255,255,255,0.03)",
                color:
                  isTyping && charsTyped >= CHAT_MESSAGE.length
                    ? "rgba(255,255,255,0.45)"
                    : "rgba(255,255,255,0.12)",
              }}
            >
              Send
            </span>
          </div>
        </div>

        {/* Right: Board */}
        <div style={{ flex: 1, padding: 20 }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
            <span
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 2,
                color: "rgba(255,255,255,0.18)",
              }}
            >
              {isInProgress ? "Board" : "To Do"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {DEMO_TASKS.map((task, i) => {
              const s = taskSprings[i]
              const isActive = isInProgress && task.id === 1
              return (
                <div
                  key={task.id}
                  style={{
                    opacity: s.opacity,
                    transform: `translateY(${s.y}px) scale(${s.scale})`,
                    border: isActive
                      ? "1px solid rgba(52,211,153,0.25)"
                      : "1px solid rgba(255,255,255,0.05)",
                    background: isActive
                      ? "rgba(52,211,153,0.05)"
                      : "rgba(255,255,255,0.02)",
                    borderRadius: 8,
                    padding: "9px 12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {isActive && (
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: `rgba(52,211,153,${0.5 + dotPulse * 0.5})`,
                          boxShadow: `0 0 6px rgba(52,211,153,${0.3 + dotPulse * 0.3})`,
                          transform: `scale(${dotScale})`,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.55)",
                        lineHeight: 1.3,
                      }}
                    >
                      {task.title}
                    </span>
                  </div>
                  <div style={{ marginTop: 5 }}>
                    <span style={{ fontSize: 10, color: `${task.color}80` }}>
                      {task.agent}
                    </span>
                    {isActive && (
                      <span
                        style={{
                          fontSize: 9,
                          color: "rgba(52,211,153,0.5)",
                          marginLeft: 8,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                        }}
                      >
                        In Progress
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            {frame < TASKS_START && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 100,
                  fontSize: 12,
                  color: "rgba(255,255,255,0.08)",
                }}
              >
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

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#0D0D0D] text-white selection:bg-amber-400/20 selection:text-white">
      {/* Nav */}
      <header className="px-6 py-5">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="font-semibold tracking-tight text-base text-white/80">
            peon.work
          </span>
          <button
            onClick={() => navigate("/login")}
            className="text-sm text-white/40 hover:text-white/70 transition-colors cursor-pointer"
          >
            Sign in
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 pt-28 sm:pt-40 pb-20 sm:pb-28">
        <div className="max-w-5xl mx-auto">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
            className="text-[clamp(2.8rem,8vw,7rem)] font-bold tracking-[-0.035em] leading-[0.95] max-w-4xl"
          >
            While you sleep,
            <br />
            your team ships.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.7,
              delay: 0.25,
              ease: [0.25, 0.1, 0.25, 1],
            }}
            className="mt-8 text-lg sm:text-xl text-white/45 max-w-xl leading-relaxed font-light"
          >
            Peon launches a team of AI agents on your codebase. You direct.
            They build. The board shows everything.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.6,
              delay: 0.5,
              ease: [0.25, 0.1, 0.25, 1],
            }}
            className="mt-10 flex flex-col sm:flex-row items-start gap-4"
          >
            <button
              onClick={() => navigate("/login")}
              className="group inline-flex items-center gap-2 bg-white text-black px-7 py-3.5 rounded-lg text-[15px] font-semibold hover:bg-white/90 transition-colors cursor-pointer"
            >
              Launch your team
              <span className="inline-block transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </button>
            <span className="text-sm text-white/25 sm:pt-3.5">
              Bring your own key. No subscription.
            </span>
          </motion.div>
        </div>
      </section>

      {/* Hero demo — Remotion Player */}
      <section className="px-6 pb-32 sm:pb-40">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.8,
            delay: 0.7,
            ease: [0.25, 0.1, 0.25, 1],
          }}
          className="max-w-3xl mx-auto rounded-xl overflow-hidden shadow-2xl shadow-black/50 border border-white/[0.08]"
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
      <section className="px-6 pb-32 sm:pb-40">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-16 md:gap-12">
            {TRUTHS.map((truth, i) => (
              <motion.div
                key={truth.number}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{
                  duration: 0.6,
                  delay: i * 0.12,
                  ease: [0.25, 0.1, 0.25, 1],
                }}
              >
                <span className="text-[64px] sm:text-[80px] font-bold leading-none tracking-[-0.04em] text-white/[0.07]">
                  {truth.number}
                </span>
                <h3 className="mt-2 text-xl sm:text-2xl font-semibold tracking-[-0.02em] text-white/90">
                  {truth.title}
                </h3>
                <p className="mt-3 text-[15px] text-white/35 leading-relaxed">
                  {truth.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it starts */}
      <section className="px-6 pb-32 sm:pb-40">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="border-t border-white/[0.06] pt-20"
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
                  transition={{
                    duration: 0.5,
                    delay: i * 0.1,
                    ease: [0.25, 0.1, 0.25, 1],
                  }}
                >
                  <span className="text-sm font-mono text-white/20">
                    {i + 1}
                  </span>
                  <p className="mt-2 text-lg text-white/70 leading-relaxed">
                    {step}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="px-6 pb-32 sm:pb-40">
        <div className="max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <h2 className="text-[clamp(2rem,5vw,4rem)] font-bold tracking-[-0.03em] leading-[1.05]">
              Stop building alone.
            </h2>
            <div className="mt-10">
              <button
                onClick={() => navigate("/login")}
                className="group inline-flex items-center gap-2 bg-white text-black px-7 py-3.5 rounded-lg text-[15px] font-semibold hover:bg-white/90 transition-colors cursor-pointer"
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
      <footer className="px-6 py-10 border-t border-white/[0.04]">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-sm text-white/20">peon.work</span>
          <span className="text-xs text-white/15">
            Bring your own Anthropic key. Your data, your models.
          </span>
        </div>
      </footer>
    </div>
  )
}
