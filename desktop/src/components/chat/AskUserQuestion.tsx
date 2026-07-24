import { useId, useMemo, useRef, useState } from 'react'
import { CircleCheck, CircleHelp, Send } from 'lucide-react'
import { listPendingPermissions, useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Checkbox } from '../ui/checkbox'
import { Label } from '../ui/label'
import { RadioGroup, RadioGroupItem } from '../ui/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Textarea } from '../ui/textarea'

type QuestionOption = {
  label: string
  description?: string
}

type Question = {
  question: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

type AskUserInput = {
  questions?: Question[]
  question?: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

type Props = {
  sessionId?: string | null
  toolUseId: string
  input: unknown
  result?: unknown
}

/**
 * Parse the AskUserQuestion input which may come in different shapes.
 */
function parseInput(input: unknown): Question[] {
  if (!input || typeof input !== 'object') return []
  const obj = input as AskUserInput

  // Shape 1: { questions: [...] }
  if (Array.isArray(obj.questions)) {
    return obj.questions
  }

  // Shape 2: { question: "...", options: [...] }
  if (typeof obj.question === 'string') {
    return [{
      question: obj.question,
      header: obj.header,
      options: obj.options,
      multiSelect: obj.multiSelect,
    }]
  }

  return []
}

type QuestionSelections = Record<number, string[]>
type QuestionFreeTexts = Record<number, string>

function getSelectedAnswer(question: Question, selected: string[] | undefined) {
  if (!selected || selected.length === 0) return ''
  return question.multiSelect ? selected.join(', ') : selected[0] ?? ''
}

export function AskUserQuestion({ sessionId, toolUseId, input, result }: Props) {
  const { respondToPermission } = useChatStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const targetSessionId = sessionId ?? activeTabId
  const pendingRequest = useChatStore((s) => targetSessionId
    ? listPendingPermissions(s.sessions[targetSessionId])
      .find((permission) => permission.toolUseId === toolUseId) ?? null
    : null)
  const t = useTranslation()
  const questions = parseInput(input)
  const inputObject = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const [activeTab, setActiveTab] = useState(0)
  const [selections, setSelections] = useState<QuestionSelections>({})
  const [freeTexts, setFreeTexts] = useState<QuestionFreeTexts>({})
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const composingRef = useRef(false)
  const questionControlId = useId()

  if (questions.length === 0) return null
  const safeActiveTab = Math.min(activeTab, questions.length - 1)
  const activeQuestion = questions[safeActiveTab]

  const resultAnswers = useMemo(() => {
    if (!result || typeof result !== 'object') return {}
    const answers = (result as { answers?: unknown }).answers
    return answers && typeof answers === 'object'
      ? answers as Record<string, string>
      : {}
  }, [result])
  const resultText = typeof result === 'string' && result.trim().length > 0 ? result.trim() : ''
  const hasStructuredAnswers = Object.keys(resultAnswers).length > 0
  const hasTerminalResult = hasStructuredAnswers || resultText.length > 0

  const answeredText = useMemo(() => {
    if (hasStructuredAnswers) {
      return questions
        .map((question) => resultAnswers[question.question])
        .filter((answer): answer is string => typeof answer === 'string' && answer.trim().length > 0)
        .join(', ')
    }
    if (resultText) return resultText
    return questions
      .map((question, index) => freeTexts[index]?.trim() || getSelectedAnswer(question, selections[index]))
      .filter(Boolean)
      .join('; ')
  }, [freeTexts, hasStructuredAnswers, questions, resultAnswers, resultText, selections])
  const submitted = hasTerminalResult || hasSubmitted
  const terminalWithoutAnswers = submitted && !hasStructuredAnswers && resultText.length > 0

  const handleSelect = (qIndex: number, label: string) => {
    if (submitted) return
    setSelections((prev) => {
      const question = questions[qIndex]
      const selected = prev[qIndex] ?? []
      if (question?.multiSelect) {
        const nextSelected = selected.includes(label)
          ? selected.filter((value) => value !== label)
          : [...selected, label]
        const next = { ...prev }
        if (nextSelected.length > 0) {
          next[qIndex] = nextSelected
        } else {
          delete next[qIndex]
        }
        return next
      }
      if (selected[0] === label) {
        const next = { ...prev }
        delete next[qIndex]
        return next
      }
      return { ...prev, [qIndex]: [label] }
    })
    setFreeTexts((prev) => {
      if (!prev[qIndex]) return prev
      const next = { ...prev }
      delete next[qIndex]
      return next
    })
  }

  const handleFreeTextChange = (qIndex: number, value: string) => {
    if (submitted) return
    setFreeTexts((prev) => {
      const next = { ...prev }
      if (value) {
        next[qIndex] = value
      } else {
        delete next[qIndex]
      }
      return next
    })
    if (value.trim()) {
      setSelections((prev) => {
        if (!prev[qIndex]) return prev
        const next = { ...prev }
        delete next[qIndex]
        return next
      })
    }
  }

  const handleSubmit = () => {
    if (submitted) return

    const parts: string[] = []
    for (let i = 0; i < questions.length; i++) {
      const answer = freeTexts[i]?.trim() || getSelectedAnswer(questions[i]!, selections[i])
      if (answer) parts.push(answer)
    }
    const response = parts.join('; ')
    if (!response) return

    if (!targetSessionId || !pendingRequest) return

    const answers = questions.reduce<Record<string, string>>((acc, question, index) => {
      const freeText = freeTexts[index]?.trim()
      if (freeText) {
        acc[question.question] = freeText
      } else {
        const selected = getSelectedAnswer(question, selections[index])
        if (selected) acc[question.question] = selected
      }
      return acc
    }, {})

    setHasSubmitted(true)
    respondToPermission(targetSessionId, pendingRequest.requestId, true, {
      updatedInput: {
        ...inputObject,
        answers,
      },
    })
  }

  // All questions must be answered (via selection or free text) to enable submit
  const allAnswered = questions.every((_, i) =>
    Boolean(freeTexts[i]?.trim()) || (selections[i]?.length ?? 0) > 0,
  )

  if (!activeQuestion) return null

  return (
    <Card className={`mb-4 overflow-hidden ${
      submitted
        ? 'border-[var(--color-outline-variant)]/40 bg-[var(--color-surface-container-low)] opacity-70'
        : 'border-[var(--color-secondary)] bg-[var(--color-surface-container-lowest)]'
    }`}>
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-3 ${
        submitted
          ? 'bg-[var(--color-surface-container-low)]'
          : 'bg-[var(--color-surface-container)]'
      }`}>
        <div className="flex items-center justify-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-secondary)]/10">
          <CircleHelp aria-hidden className="size-[18px] text-[var(--color-secondary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t('question.needsInput')}
          </span>
          {submitted && (
            <Badge
              variant="secondary"
              className="ml-2 border-transparent bg-[var(--color-surface-container-high)] text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]"
            >
              {t(terminalWithoutAnswers ? 'question.completed' : 'question.answered')}
            </Badge>
          )}
        </div>
      </div>

      <Tabs
        value={String(safeActiveTab)}
        onValueChange={(value) => setActiveTab(Number(value))}
        className="block"
      >
        {/* Question tabs — horizontal tab bar (only show when multiple questions) */}
        {questions.length > 1 && (
          <div className="overflow-x-auto border-b border-[var(--color-outline-variant)]/20 bg-[var(--color-surface-container-low)] px-4">
          <TabsList aria-label={t('question.needsInput')}>
            {questions.map((q, i) => {
              const isAnswered = Boolean(freeTexts[i]?.trim()) || (selections[i]?.length ?? 0) > 0
              const tabLabel = q.header || `Q${i + 1}`
              return (
                <TabsTrigger
                  key={i}
                  value={String(i)}
                  className="relative rounded-none px-4 py-2.5 text-xs text-[var(--color-text-tertiary)] hover:bg-transparent hover:text-[var(--color-text-secondary)] data-[state=active]:bg-transparent data-[state=active]:text-[var(--color-secondary)] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:rounded-t after:bg-transparent data-[state=active]:after:bg-[var(--color-secondary)]"
                >
                  {isAnswered && <CircleCheck aria-hidden className="size-3.5 text-[var(--color-success)]" />}
                  {tabLabel}
                </TabsTrigger>
              )
            })}
          </TabsList>
          </div>
        )}

        {/* Active question content */}
        <TabsContent value={String(safeActiveTab)} forceMount className="px-4 py-3">
        <p className="text-sm font-medium text-[var(--color-text-primary)] mb-3">
          {activeQuestion.question}
        </p>

        {/* Option cards */}
        {activeQuestion.options && activeQuestion.options.length > 0 && (
          activeQuestion.multiSelect ? (
            <div className="mb-3 space-y-2" role="group" aria-label={activeQuestion.question}>
              {activeQuestion.options.map((opt, optIndex) => {
                const isSelected = selections[safeActiveTab]?.includes(opt.label) ?? false
                const optionId = `${questionControlId}-${safeActiveTab}-${optIndex}`
                return (
                  <Label
                    key={optIndex}
                    htmlFor={optionId}
                    className={`cursor-pointer items-start rounded-[var(--radius-md)] border px-4 py-3 transition-all duration-150 ${
                      isSelected
                        ? 'border-[var(--color-secondary)] bg-[var(--color-secondary)]/8 ring-1 ring-[var(--color-secondary)]/30'
                        : 'border-[var(--color-outline-variant)]/40 bg-[var(--color-surface)] hover:border-[var(--color-outline-variant)] hover:bg-[var(--color-surface-container-low)]'
                    }`}
                  >
                    <Checkbox
                      id={optionId}
                      checked={isSelected}
                      disabled={submitted}
                      onCheckedChange={() => handleSelect(safeActiveTab, opt.label)}
                      className="mt-0.5 data-[state=checked]:border-[var(--color-secondary)] data-[state=checked]:bg-[var(--color-secondary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className={isSelected ? 'text-sm font-medium text-[var(--color-secondary)]' : 'text-sm font-medium'}>
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className="mt-0.5 block text-xs font-normal leading-5 text-[var(--color-text-secondary)]">
                          {opt.description}
                        </span>
                      )}
                    </span>
                  </Label>
                )
              })}
            </div>
          ) : (
            <RadioGroup
              value={selections[safeActiveTab]?.[0] ?? ''}
              onValueChange={(value) => handleSelect(safeActiveTab, value)}
              disabled={submitted}
              aria-label={activeQuestion.question}
              className="mb-3"
            >
              {activeQuestion.options.map((opt, optIndex) => {
                const isSelected = selections[safeActiveTab]?.includes(opt.label) ?? false
                const optionId = `${questionControlId}-${safeActiveTab}-${optIndex}`
                return (
                  <Label
                    key={optIndex}
                    htmlFor={optionId}
                    className={`cursor-pointer items-start rounded-[var(--radius-md)] border px-4 py-3 transition-all duration-150 ${
                      isSelected
                        ? 'border-[var(--color-secondary)] bg-[var(--color-secondary)]/8 ring-1 ring-[var(--color-secondary)]/30'
                        : 'border-[var(--color-outline-variant)]/40 bg-[var(--color-surface)] hover:border-[var(--color-outline-variant)] hover:bg-[var(--color-surface-container-low)]'
                    }`}
                  >
                    <RadioGroupItem
                      id={optionId}
                      value={opt.label}
                      className="mt-0.5 text-[var(--color-secondary)] data-[state=checked]:border-[var(--color-secondary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className={isSelected ? 'text-sm font-medium text-[var(--color-secondary)]' : 'text-sm font-medium'}>
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className="mt-0.5 block text-xs font-normal leading-5 text-[var(--color-text-secondary)]">
                          {opt.description}
                        </span>
                      )}
                    </span>
                  </Label>
                )
              })}
            </RadioGroup>
          )
        )}

        {/* Free text input */}
        {!submitted && (
          <div>
            <Label
              htmlFor={`${questionControlId}-custom-${safeActiveTab}`}
              className="mb-1.5 block text-xs font-normal text-[var(--color-text-tertiary)]"
            >
              {t('question.customResponse')}
            </Label>
            <Textarea
              id={`${questionControlId}-custom-${safeActiveTab}`}
              value={freeTexts[safeActiveTab] ?? ''}
              onChange={(e) => handleFreeTextChange(safeActiveTab, e.target.value)}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={() => { composingRef.current = false }}
              onKeyDown={(e) => {
                if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && allAnswered) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder={t('question.typePlaceholder')}
              rows={3}
              wrap="soft"
              className="max-h-48 min-h-[84px] resize-y border-[var(--color-outline-variant)]/40 focus-visible:border-[var(--color-secondary)] focus-visible:shadow-[0_0_0_1px_var(--color-secondary)]"
            />
          </div>
        )}

        {/* Submitted answer display */}
        {submitted && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <CircleCheck aria-hidden className="size-3.5 text-[var(--color-success)]" />
            <span>
              {t(terminalWithoutAnswers ? 'question.resultPrefix' : 'question.answeredPrefix')}<strong>{answeredText}</strong>
            </span>
          </div>
        )}
        </TabsContent>
      </Tabs>

      {/* Submit button */}
      {!submitted && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--color-outline-variant)]/20 bg-[var(--color-surface-container-low)]">
          <Button
            size="sm"
            disabled={!allAnswered || !pendingRequest}
            onClick={handleSubmit}
          >
            <Send aria-hidden className="size-3.5" />
            {t('question.submit')}
          </Button>
        </div>
      )}
    </Card>
  )
}
