"use client"

import {
  DescriptiveButton,
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button"
import { useMessageList } from "@/components/chat/message-list-provider"
import { cn } from "@/lib/utils"
import { BoltIcon, DocumentTextIcon, PencilSquareIcon, TableCellsIcon } from "@heroicons/react/24/solid"

const REVIEW_GRID_PROMPT =
  "Review the contracts in this folder and build a review grid — one row per document, with columns for the parties, effective date, term, governing law, and assignment/change-of-control. Put a short value in each cell with a citation to the source document, and flag anything missing or unusual."

const REDLINE_PROMPT =
  "Redline this contract: propose your changes as tracked redlines and give me a short rationale for each. If we have a standard template or playbook, mark it up against that."

const SUMMARIZE_PROMPT =
  "Summarize the contracts in this folder. For each one, note what it is in a sentence, then give me an overall summary of what this set covers and anything that stands out — citing the source file for the important points."

interface TaskSuggestionsProps {
  className?: string
}

export function TaskSuggestions({ className }: TaskSuggestionsProps) {
  const { displaySuggestions, providerConnectedCount, dispatchAction, setPrompt } = useMessageList()

  if (!displaySuggestions) {
    return null
  }

  const noProviders = providerConnectedCount === 0

  return (
    <div className={cn("@container flex flex-col gap-4 pt-1", className)}>
      <p className="text-muted-foreground font-medium select-none">
        {noProviders ? "Connect a model provider to get started:" : "Try one of these:"}
      </p>
      <div className="grid min-w-0 gap-2 @lg:grid-cols-2 @2xl:grid-cols-3">
        {noProviders ? (
          <DescriptiveButton
            orientation="vertical"
            className="border-blue-7/50 bg-blue-2/30 hover:bg-blue-3/40 @lg:col-span-2 @2xl:col-span-3"
            onClick={() =>
              dispatchAction({
                target: "settings",
                action: "open",
                section: "providers",
              })
            }
          >
            <DescriptiveButtonIcon>
              <BoltIcon className="size-6 text-blue-10" aria-hidden />
            </DescriptiveButtonIcon>
            <DescriptiveButtonContent>
              <DescriptiveButtonTitle>Connect a model provider</DescriptiveButtonTitle>
              <DescriptiveButtonDescription>
                Add an API key for Anthropic, OpenAI, Google, or others
              </DescriptiveButtonDescription>
            </DescriptiveButtonContent>
          </DescriptiveButton>
        ) : null}

        <DescriptiveButton orientation="vertical" onClick={() => setPrompt(REVIEW_GRID_PROMPT)}>
          <DescriptiveButtonIcon>
            <TableCellsIcon className="size-6 text-blue-10" aria-hidden />
          </DescriptiveButtonIcon>
          <DescriptiveButtonContent>
            <DescriptiveButtonTitle>Build a review grid</DescriptiveButtonTitle>
            <DescriptiveButtonDescription>Extract key terms across many documents</DescriptiveButtonDescription>
          </DescriptiveButtonContent>
        </DescriptiveButton>

        <DescriptiveButton orientation="vertical" onClick={() => setPrompt(REDLINE_PROMPT)}>
          <DescriptiveButtonIcon>
            <PencilSquareIcon className="size-6 text-amber-10" aria-hidden />
          </DescriptiveButtonIcon>
          <DescriptiveButtonContent>
            <DescriptiveButtonTitle>Redline a contract</DescriptiveButtonTitle>
            <DescriptiveButtonDescription>Propose tracked changes with rationale</DescriptiveButtonDescription>
          </DescriptiveButtonContent>
        </DescriptiveButton>

        <DescriptiveButton orientation="vertical" onClick={() => setPrompt(SUMMARIZE_PROMPT)}>
          <DescriptiveButtonIcon>
            <DocumentTextIcon className="size-6 text-green-10" aria-hidden />
          </DescriptiveButtonIcon>
          <DescriptiveButtonContent>
            <DescriptiveButtonTitle>Summarize documents</DescriptiveButtonTitle>
            <DescriptiveButtonDescription>Get an overview of every file</DescriptiveButtonDescription>
          </DescriptiveButtonContent>
        </DescriptiveButton>
      </div>
    </div>
  )
}
