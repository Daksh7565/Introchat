import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorText } from '../../../components/ErrorText'
import {
  addBlockedTerm,
  listBlockedTerms,
  listTags,
  removeBlockedTerm,
  safetyKeys,
  setTagBlocked,
} from './api'

/**
 * Interest tags and the blocked-words list. Blocking a tag hides it from
 * every card and suggestion at once; a blocked word stops new tags that
 * contain it (tags already in use are blocked one by one, here).
 */
export function TagsPage() {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">{t('admin.tags.title')}</h2>
      <TagSearch />
      <BlockedWords />
    </section>
  )
}

function TagSearch() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const tags = useQuery({ queryKey: safetyKeys.tags(query), queryFn: () => listTags(query) })
  const toggle = useMutation({
    mutationFn: ({ name, blocked }: { name: string; blocked: boolean }) =>
      setTagBlocked(name, blocked),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: safetyKeys.allTags }),
  })

  return (
    <div className="flex flex-col gap-2 text-sm">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setQuery(draft.trim())
        }}
      >
        <input
          value={draft}
          aria-label={t('admin.tags.search')}
          placeholder={t('admin.tags.search')}
          onChange={(event) => setDraft(event.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1.5"
        />
        <button
          type="submit"
          className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold"
        >
          {t('admin.guests.find')}
        </button>
      </form>
      <ErrorText error={tags.error ?? toggle.error} />
      <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200">
        {tags.data?.map((tag) => (
          <li key={tag.name} className="flex items-center justify-between gap-2 p-2">
            <span className={tag.isBlocked ? 'text-rose-800 line-through' : ''}>
              {tag.name}{' '}
              <span className="text-xs text-slate-500">
                ({t('admin.tags.users', { count: tag.users })})
              </span>
            </span>
            <button
              type="button"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate({ name: tag.name, blocked: !tag.isBlocked })}
              className={`rounded-lg px-3 py-1 font-semibold ${tag.isBlocked ? 'border border-slate-300' : 'bg-rose-700 text-white'}`}
            >
              {tag.isBlocked ? t('admin.tags.unblock') : t('admin.tags.block')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function BlockedWords() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [term, setTerm] = useState('')
  const terms = useQuery({ queryKey: safetyKeys.terms, queryFn: listBlockedTerms })
  const refresh = () => queryClient.invalidateQueries({ queryKey: safetyKeys.terms })
  const add = useMutation({
    mutationFn: () => addBlockedTerm(term),
    onSuccess: () => {
      setTerm('')
      return refresh()
    },
  })
  const remove = useMutation({ mutationFn: removeBlockedTerm, onSuccess: refresh })

  return (
    <div className="flex flex-col gap-2 text-sm">
      <h3 className="font-semibold">{t('admin.tags.blockedWords')}</h3>
      <p className="text-slate-600">{t('admin.tags.blockedWordsHelp')}</p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (term.trim() !== '') add.mutate()
        }}
      >
        <input
          value={term}
          aria-label={t('admin.tags.addWord')}
          onChange={(event) => setTerm(event.target.value)}
          className="rounded-lg border border-slate-300 px-2 py-1.5"
        />
        <button
          type="submit"
          disabled={add.isPending}
          className="rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white disabled:bg-slate-300"
        >
          {t('admin.tags.addWord')}
        </button>
      </form>
      <ErrorText error={terms.error ?? add.error ?? remove.error} />
      <ul className="flex flex-wrap gap-2">
        {terms.data?.map((word) => (
          <li key={word} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
            {word}
            <button
              type="button"
              disabled={remove.isPending}
              aria-label={t('admin.tags.removeWord', { word })}
              onClick={() => remove.mutate(word)}
              className="text-slate-500"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
