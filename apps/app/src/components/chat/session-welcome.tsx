"use client"

import { motion, useReducedMotion } from "motion/react"
import { useContext, type ReactNode } from "react"
import { ChatWorkspaceContext } from "./chat-workspace-context"
import { useMessageList } from "@/components/chat/message-list-provider"
import { TaskSuggestions } from "@/components/chat/task-suggestions"
import { t } from "@/i18n";
import "./session-surfaces.css"

export function WelcomeHeading() {
  const wiki = useContext(ChatWorkspaceContext) === "wiki"
  const headline = t(wiki ? "session_welcome.wiki_headline" : "session_welcome.headline")
  return (
    <motion.div
      className="lw-session-welcome-heading"
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.42, ease: "easeOut" } },
      }}
    >
      <h2 className="lw-session-welcome-title">
        {t("session_welcome.greeting")}{" "}
        <span className="sr-only">{headline}</span>
        <span aria-hidden="true">
          {Array.from(headline, (letter, index) => (
            <span key={index} className="lw-welcome-letter" style={{ animationDelay: `${500 + index * 40}ms` }}>{letter}</span>
          ))}
        </span>
      </h2>
      <p className="lw-session-welcome-description">
        {t(wiki ? "session_welcome.wiki_subtitle" : "session_welcome.subtitle")}
      </p>
    </motion.div>
  )
}

/** A quiet, one-time entrance for each empty conversation. */
export function WelcomeSurface({ children, replayKey }: { children: ReactNode; replayKey: string }) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.section
      key={replayKey}
      aria-label={t("session_welcome.start_conversation")}
      className="lw-session-welcome"
      initial={reduceMotion ? false : "hidden"}
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: reduceMotion ? 0 : 0.075 } },
      }}
    >
      <WelcomeHeading />
      {children}
    </motion.section>
  )
}

export function SessionWelcome() {
  const { sessionId } = useMessageList()
  return <WelcomeSurface replayKey={sessionId}><TaskSuggestions /></WelcomeSurface>
}
