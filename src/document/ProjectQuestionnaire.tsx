import { cloneElement, isValidElement, useId, useMemo, useState } from 'react'
import type { ProjectQuestionnaire as ProjectQuestionnaireData } from '../model/project'
import { QuestionnaireThemeMenu } from './QuestionnaireThemeMenu'

type QuestionnaireProps = {
  projectTitle: string
  value: ProjectQuestionnaireData
  theme: 'navy' | 'dark' | 'light'
  readOnly?: boolean
  onProjectTitleChange: (title: string) => void
  onChange: (value: ProjectQuestionnaireData) => void
}

type FieldName = Exclude<keyof ProjectQuestionnaireData, 'difficulty'>

const PROGRESS_FIELDS: Array<FieldName | 'projectTitle'> = [
  'projectTitle', 'summary', 'count', 'time', 'deliverables', 'purpose', 'audience',
  'challenges', 'solution', 'tools', 'narrative', 'references', 'stage1', 'stage2', 'stage3',
]

const SECTIONS = [
  ['identity', 'Identity'],
  ['deliverables', 'Deliverables'],
  ['scope', 'Scope'],
  ['references', 'Visual data'],
  ['production', 'Production'],
] as const

export function ProjectQuestionnaire({ projectTitle, value, theme, readOnly = false, onProjectTitleChange, onChange }: QuestionnaireProps) {
  const [showOutline, setShowOutline] = useState(true)
  const [paperTheme, setPaperTheme] = useState<'navy' | 'dark' | 'light'>(theme)
  const completed = useMemo(() => PROGRESS_FIELDS.filter((field) => {
    const fieldValue = field === 'projectTitle' ? projectTitle : value[field]
    return fieldValue.trim().length > 0
  }).length, [projectTitle, value])

  function update(field: keyof ProjectQuestionnaireData, nextValue: string) {
    if (!readOnly) onChange({ ...value, [field]: nextValue })
  }

  function jumpTo(sectionId: string) {
    document.getElementById(`questionnaire-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className={`document-pane questionnaire-pane questionnaire-theme-${paperTheme}`} aria-label="Project questionnaire">
      <div className="pane-toolbar questionnaire-toolbar" role="toolbar" aria-label="Questionnaire navigation">
        <button className={`format-button outline-button ${showOutline ? 'active' : ''}`} type="button" aria-label="Toggle questionnaire outline" aria-expanded={showOutline} onClick={() => setShowOutline((visible) => !visible)}>☷</button>
        <span className="questionnaire-toolbar-title">Standard project questionnaire</span>
        <span className="toolbar-spacer" />
        <span className="questionnaire-progress-label">{completed} of {PROGRESS_FIELDS.length} answered</span>
        <span className="questionnaire-progress" role="progressbar" aria-label="Questionnaire completion" aria-valuemin={0} aria-valuemax={PROGRESS_FIELDS.length} aria-valuenow={completed}><i style={{ width: `${completed / PROGRESS_FIELDS.length * 100}%` }} /></span>
        <QuestionnaireThemeMenu value={paperTheme} onChange={setPaperTheme} />
        <button className="quiet-button compact" type="button" onClick={() => window.print()}>Print / PDF</button>
      </div>

      <div className="document-stage questionnaire-stage">
        {showOutline && <nav className="questionnaire-outline" aria-label="Questionnaire sections">
          <header><span>Project planning</span><strong>{Math.round(completed / PROGRESS_FIELDS.length * 100)}%</strong></header>
          {SECTIONS.map(([id, label], index) => <button type="button" key={id} onClick={() => jumpTo(id)}><span>{String(index + 1).padStart(2, '0')}</span>{label}</button>)}
          <p>Every project begins with this same planning document. Empty answers remain visible—nothing is silently discarded.</p>
        </nav>}

        <form className="questionnaire-paper" onSubmit={(event) => event.preventDefault()}>
          <header className="paper-header"><span>ART EQUATION / PROJECT QUESTIONNAIRE</span><span>{completed} / {PROGRESS_FIELDS.length}</span></header>
          <div className="questionnaire-hero" id="questionnaire-identity">
            <p className="questionnaire-kicker">Active project · pre-production</p>
            <label className="questionnaire-title"><span>Project title</span><textarea readOnly={readOnly} rows={2} value={projectTitle} placeholder="Untitled project" onChange={(event) => { if (!readOnly) onProjectTitleChange(event.target.value) }} /></label>
            <p className="questionnaire-deck">Decide the scope, production path, and real labor before the image becomes expensive to fix.</p>
          </div>

          <div className="questionnaire-grid identity-grid">
            <Field label="Project date"><input readOnly={readOnly} type="date" value={value.date} onChange={(event) => update('date', event.target.value)} /></Field>
            <Field label="Tags"><input readOnly={readOnly} value={value.tags} placeholder="personal, environment, turnaround…" onChange={(event) => update('tags', event.target.value)} /></Field>
            <Field label="Images / shots"><input readOnly={readOnly} value={value.count} placeholder="e.g. 6 images" onChange={(event) => update('count', event.target.value)} /></Field>
            <Field label="Time estimate"><input readOnly={readOnly} value={value.time} placeholder="e.g. 2 days" onChange={(event) => update('time', event.target.value)} /></Field>
            <Field label="Difficulty"><select disabled={readOnly} value={value.difficulty} onChange={(event) => update('difficulty', event.target.value)}><option>Undecided</option><option>Low</option><option>Medium</option><option>High</option><option>Experimental</option></select></Field>
          </div>
          <Question number="00" title="What are we making?" prompt="A short description of the project, scene, set, or visual goal."><textarea readOnly={readOnly} value={value.summary} placeholder="Describe the actual project…" onChange={(event) => update('summary', event.target.value)} /></Question>

          <Stage id="deliverables" number="01" title="Process identification & deliverables" />
          <Question title="Deliverables" tag="What comes out?" prompt="List the actual outputs: shot lists, redraws, turn sheets, final images, 3D blockouts, prompts, or something else."><textarea readOnly={readOnly} value={value.deliverables} placeholder="What must exist when this project is complete?" onChange={(event) => update('deliverables', event.target.value)} /></Question>
          <div className="questionnaire-grid two-column">
            <Question title="Purpose" tag="Why this?"><textarea readOnly={readOnly} value={value.purpose} placeholder="Reference-only, final render, sellable asset, character development…" onChange={(event) => update('purpose', event.target.value)} /></Question>
            <Question title="Audience / taste target"><textarea readOnly={readOnly} value={value.audience} placeholder="Who is this for? What visual language should it speak?" onChange={(event) => update('audience', event.target.value)} /></Question>
          </div>

          <Stage id="scope" number="02" title="Scope & problem solving" />
          <Question title="Potential challenges" tag="Name the hard part" prompt="What is likely to break: consistency, backgrounds, fashion continuity, spatial logic, a pose, cost, or something else?"><textarea readOnly={readOnly} value={value.challenges} placeholder="Name the known problems before production begins…" onChange={(event) => update('challenges', event.target.value)} /></Question>
          <Question title="Planned solution" tag="Choose a method" prompt="Which manual, AI, or 3D steps solve each risk? Keep this specific, not aspirational."><textarea readOnly={readOnly} value={value.solution} placeholder="Match a concrete method to each risk…" onChange={(event) => update('solution', event.target.value)} /></Question>
          <Question title="Tools, labor & cost" tag="Reality check" prompt="Tools, subscriptions, model limits, available labor, estimated cost, and what is not worth doing."><textarea readOnly={readOnly} value={value.tools} placeholder="What will this actually require?" onChange={(event) => update('tools', event.target.value)} /></Question>

          <Stage id="references" number="03" title="Narrative & visual data" />
          <div className="questionnaire-grid two-column">
            <Question title="Narrative data sources" tag="Story material" prompt="What existing stories, characters, or ideas feed this project?"><textarea readOnly={readOnly} value={value.narrative} placeholder="Story, character, world, themes…" onChange={(event) => update('narrative', event.target.value)} /></Question>
            <Question title="Visual reference strategy" tag="Construction data" prompt="Manga, film, photography, design, poses, environments, fashion—and what each source teaches."><textarea readOnly={readOnly} value={value.references} placeholder="Reference source → what it contributes…" onChange={(event) => update('references', event.target.value)} /></Question>
          </div>

          <Stage id="production" number="04" title="Production path" />
          <Question title="Stage 1 — Spatial data / sketch" tag="Blockout" prompt="Reference collection, photobash, simple 3D blockout, gesture sketch, and spatial decisions."><textarea readOnly={readOnly} value={value.stage1} placeholder="How will you establish the space and composition?" onChange={(event) => update('stage1', event.target.value)} /></Question>
          <Question title="Stage 2 — Conversion & construction" tag="Make it workable" prompt="Sketch conversion, drawing, recrafting, vectorization, character or environment correction."><textarea readOnly={readOnly} value={value.stage2} placeholder="How will the blockout become production-ready?" onChange={(event) => update('stage2', event.target.value)} /></Question>
          <Question title="Stage 3 — Finish & verification" tag="Final call" prompt="Render decision, style and lighting unification, final corrections, consistency checks, and delivery."><textarea readOnly={readOnly} value={value.stage3} placeholder="How will you finish, verify, and deliver?" onChange={(event) => update('stage3', event.target.value)} /></Question>
          <footer className="questionnaire-footer"><span>Art Equation Studio</span><span>Project planning record</span></footer>
        </form>
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="questionnaire-field"><span>{label}</span>{children}</label>
}

function Stage({ id, number, title }: { id: string; number: string; title: string }) {
  return <header className="questionnaire-stage-heading" id={`questionnaire-${id}`}><span>{number}</span><h2>{title}</h2></header>
}

function Question({ number, title, tag, prompt, children }: { number?: string; title: string; tag?: string; prompt?: string; children: React.ReactNode }) {
  const headingId = useId()
  const labeledChild = isValidElement<{ 'aria-labelledby'?: string }>(children) ? cloneElement(children, { 'aria-labelledby': headingId }) : children
  return <section className="questionnaire-question"><header>{number && <span className="question-number">{number}</span>}<h3 id={headingId}>{title}</h3>{tag && <span className="question-tag">{tag}</span>}</header>{prompt && <p>{prompt}</p>}{labeledChild}</section>
}
