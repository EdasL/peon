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
import { MessageBox } from "react-chat-elements"
import "react-chat-elements/dist/main.css"

// ─── Remotion hero composition ───

const TOTAL_FRAMES = 360

function FemrunPhone() {
  const PINK = "#E87070"
  return (
    <div
      style={{
        width: 220,
        height: 440,
        borderRadius: 36,
        background: "#1A1A1A",
        border: "3px solid #2A2A2A",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 40px 80px rgba(0,0,0,0.7)",
      }}
    >
      <div style={{ flex: 1, background: "#0F0F0F", padding: "32px 20px 20px", display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 3,
            color: PINK,
            fontWeight: 600,
            fontFamily: "'Instrument Sans', system-ui, sans-serif",
          }}
        >
          femrun
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 22,
            fontWeight: 600,
            color: "#FFFFFF",
            fontFamily: "'Instrument Sans', system-ui, sans-serif",
          }}
        >
          Week 3 · Day 2
        </div>

        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Easy Run card */}
          <div
            style={{
              background: "#1A1A1A",
              borderRadius: 8,
              padding: "12px 14px",
              borderLeft: `3px solid ${PINK}`,
            }}
          >
            <div style={{ fontSize: 13, color: "#F0EDE8", fontWeight: 500, fontFamily: "'Instrument Sans', system-ui, sans-serif" }}>
              Easy Run · 45 min
            </div>
          </div>
          {/* Strength card */}
          <div
            style={{
              background: "#1A1A1A",
              borderRadius: 8,
              padding: "12px 14px",
              borderLeft: "3px solid #888",
            }}
          >
            <div style={{ fontSize: 13, color: "#F0EDE8", fontWeight: 500, fontFamily: "'Instrument Sans', system-ui, sans-serif" }}>
              Strength · 30 min
            </div>
          </div>
          {/* Rest card */}
          <div
            style={{
              background: "#141414",
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 13, color: "#666", fontWeight: 500, fontFamily: "'Instrument Sans', system-ui, sans-serif" }}>
              Rest
            </div>
          </div>
        </div>

        {/* Progress dots */}
        <div style={{ marginTop: "auto", paddingTop: 24, display: "flex", justifyContent: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: PINK }} />
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: PINK }} />
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#333", border: "1px solid #555" }} />
        </div>
      </div>
    </div>
  )
}

function HeroDemoComposition() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const FONT = "'Instrument Sans', system-ui, sans-serif"

  // ── Act 1: Chat (0–110) ──
  const msg1Spring = spring({ frame: frame - 15, fps, config: { damping: 22, stiffness: 80 } })
  const msg1Opacity = frame >= 15 ? interpolate(msg1Spring, [0, 1], [0, 1]) : 0
  const msg1Y = frame >= 15 ? interpolate(msg1Spring, [0, 1], [10, 0]) : 10

  const msg2Spring = spring({ frame: frame - 55, fps, config: { damping: 22, stiffness: 80 } })
  const msg2Opacity = frame >= 55 ? interpolate(msg2Spring, [0, 1], [0, 1]) : 0
  const msg2Y = frame >= 55 ? interpolate(msg2Spring, [0, 1], [10, 0]) : 10

  // ── Act 2: Launch (110–145) ──
  const launchProgress = interpolate(frame, [110, 145], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.4, 0, 1, 1),
  })
  const chatX = frame >= 110 ? interpolate(launchProgress, [0, 1], [0, -160]) : 0
  const chatBlur = frame >= 110 ? interpolate(launchProgress, [0, 1], [0, 28]) : 0

  // Background flicker in Act 2
  const flickerOpacity = (frame >= 120 && frame < 124) ? 0.3 : 1

  // ── Act 3: Phone reveal (145–290) ──
  const phoneSpring = spring({ frame: frame - 145, fps, config: { damping: 18, stiffness: 55 } })
  const phoneScale = frame >= 145 ? interpolate(phoneSpring, [0, 1], [0.75, 1]) : 0.75
  const phoneY = frame >= 145 ? interpolate(phoneSpring, [0, 1], [50, 0]) : 50
  const phoneOpacity = frame >= 145 ? interpolate(phoneSpring, [0, 1], [0, 1]) : 0

  // Underglow
  const glowOpacity = interpolate(frame, [210, 260], [0, 0.15], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  // Wordmark + subtitle
  const wordmarkOpacity = interpolate(frame, [230, 245], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  const subtitleOpacity = interpolate(frame, [250, 265], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  // ── Act 4: The Question (290–360) ──
  const act4FadeOut = interpolate(frame, [290, 298], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  const QUESTION = "Ready to ship a new app everyday?"
  const typingStart = 305
  const charsTyped = frame >= typingStart ? Math.min(Math.floor((frame - typingStart) / 2), QUESTION.length) : 0
  const questionText = QUESTION.slice(0, charsTyped)

  const questionFadeOut = interpolate(frame, [350, 358], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  // Determine which act we're in for rendering
  const showChat = frame < 145
  const showPhone = frame >= 145 && frame < 290
  const showQuestion = frame >= 290

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0D0C0B",
        fontFamily: FONT,
      }}
    >
      {/* Acts 1 & 2: Chat bubbles */}
      {showChat && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            opacity: flickerOpacity,
            transform: `translateX(${chatX}%)`,
            filter: `blur(${chatBlur}px)`,
          }}
        >
          {/* Message 1 — user, right */}
          <div
            className="rce-dark-user"
            style={{
              width: 380,
              opacity: msg1Opacity,
              transform: `translateY(${msg1Y}px)`,
            }}
          >
            <MessageBox
              id="hero-msg-1"
              position="right"
              type="text"
              title=""
              text="yo, ready to ship?"
              date={null as unknown as Date}
              dateString=""
              focus={false}
              forwarded={false}
              replyButton={false}
              removeButton={false}
              notch={true}
              retracted={false}
              status="sent"
              titleColor=""
              styles={{
                background: "rgba(255,255,255,0.07)",
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
                border: "1px solid rgba(255,255,255,0.1)",
                boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
                borderRadius: 14,
                color: "#FFFFFF",
                fontFamily: FONT,
                fontSize: 14,
              }}
              notchStyle={{
                fill: "rgba(255,255,255,0.07)",
              }}
            />
          </div>

          {/* Message 2 — Peon, left */}
          <div
            className="rce-dark-peon"
            style={{
              width: 380,
              opacity: msg2Opacity,
              transform: `translateY(${msg2Y}px)`,
            }}
          >
            <MessageBox
              id="hero-msg-2"
              position="left"
              type="text"
              title="peon"
              text="been shipping. want to see?"
              date={null as unknown as Date}
              dateString=""
              focus={false}
              forwarded={false}
              replyButton={false}
              removeButton={false}
              notch={true}
              retracted={false}
              status="sent"
              titleColor="rgba(232,176,85,0.6)"
              styles={{
                background: "rgba(232,176,85,0.08)",
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
                border: "1px solid rgba(232,176,85,0.12)",
                boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
                borderRadius: 14,
                color: "#F0EDE8",
                fontFamily: FONT,
                fontSize: 14,
              }}
              notchStyle={{
                fill: "rgba(232,176,85,0.08)",
              }}
            />
          </div>
        </div>
      )}

      {/* Act 3: Phone reveal */}
      {showPhone && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            opacity: act4FadeOut,
          }}
        >
          {/* Underglow */}
          <div
            style={{
              position: "absolute",
              width: 400,
              height: 400,
              borderRadius: "50%",
              background: "radial-gradient(circle, #E87070 0%, transparent 70%)",
              opacity: glowOpacity,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -30%)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              transform: `scale(${phoneScale}) translateY(${phoneY}px)`,
              opacity: phoneOpacity,
            }}
          >
            <FemrunPhone />
          </div>

          {/* Wordmark */}
          <div
            style={{
              marginTop: 20,
              opacity: wordmarkOpacity,
              color: "#FFFFFF",
              fontSize: 13,
              letterSpacing: 6,
              textTransform: "uppercase",
              fontWeight: 400,
              fontFamily: FONT,
            }}
          >
            femrun
          </div>

          {/* Subtitle */}
          <div
            style={{
              marginTop: 6,
              opacity: subtitleOpacity,
              color: "#8C8980",
              fontSize: 11,
              fontFamily: FONT,
            }}
          >
            women's running coach
          </div>
        </div>
      )}

      {/* Act 4: The Question */}
      {showQuestion && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: questionFadeOut,
          }}
        >
          <span
            style={{
              fontSize: 20,
              fontWeight: 400,
              color: "#FFFFFF",
              fontFamily: FONT,
            }}
          >
            {questionText}
          </span>
        </div>
      )}
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
            compositionHeight={420}
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
