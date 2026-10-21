// Round avatar for an anonymous handle: its first letter on a colour derived
// from the handle, so the same person always looks the same in every list.
// Full class strings (not built from parts) so Tailwind can find them.
const COLOURS = [
  'bg-teal-100 text-teal-800',
  'bg-amber-100 text-amber-800',
  'bg-sky-100 text-sky-800',
  'bg-rose-100 text-rose-800',
  'bg-violet-100 text-violet-800',
  'bg-lime-100 text-lime-800',
  'bg-orange-100 text-orange-800',
  'bg-indigo-100 text-indigo-800',
] as const

function colourFor(handle: string): string {
  let hash = 0
  for (const char of handle) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  }
  return COLOURS[hash % COLOURS.length] ?? COLOURS[0]
}

interface HandleAvatarProps {
  handle: string
  online?: boolean
  size?: 'md' | 'lg'
}

export function HandleAvatar({ handle, online, size = 'md' }: HandleAvatarProps) {
  const dimensions = size === 'lg' ? 'h-12 w-12 text-lg' : 'h-10 w-10 text-base'
  return (
    <span className="relative inline-flex shrink-0" aria-hidden="true">
      <span
        className={`inline-flex items-center justify-center rounded-full font-semibold ${dimensions} ${colourFor(handle)}`}
      >
        {handle.charAt(0).toUpperCase()}
      </span>
      {online !== undefined && (
        <span
          className={`absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-white ${online ? 'bg-emerald-500' : 'bg-slate-300'}`}
        />
      )}
    </span>
  )
}
