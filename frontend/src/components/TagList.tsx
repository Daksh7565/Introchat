interface TagListProps {
  tags: string[]
  /** Tags the viewer also has; shown highlighted (ARCHITECTURE §4.7). */
  sharedTags: string[]
}

export function TagList({ tags, sharedTags }: TagListProps) {
  const shared = new Set(sharedTags)
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li
          key={tag}
          className={
            shared.has(tag)
              ? 'rounded-full bg-teal-600 px-2.5 py-0.5 text-xs font-semibold text-white'
              : 'rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700'
          }
        >
          {tag}
        </li>
      ))}
    </ul>
  )
}
