import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ErrorText } from '../../../components/ErrorText'
import {
  adminKeys,
  createVenue,
  invalidField,
  slugFromName,
  type VenueInput,
  venueInputProblems,
} from './api'
import { PinEditor } from './PinEditor'
import type { MapPoint } from './PinMap'
import { VenueDetailsFields } from './VenueDetailsFields'

// Where the map opens for a new venue (central Ahmedabad, the pilot city) until
// this device's location arrives. It is only a starting view: the venue cannot
// be created until the pin is placed, so no venue is saved here by accident.
const START_PIN: MapPoint = { latitude: 23.0225, longitude: 72.5714 }
// Global default radius, drawn until the venue exists and has its own settings.
const DEFAULT_RADIUS_M = 40

export function VenueCreatePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [details, setDetails] = useState<VenueInput>({
    name: '',
    slug: '',
    type: 'cafe',
    address: '',
    city: '',
  })
  // The slug follows the name until the admin edits it themselves.
  const [slugEdited, setSlugEdited] = useState(false)
  const [pin, setPin] = useState<MapPoint | null>(null)
  // Problems are shown from the first Create press on, then update as they are fixed.
  const [showProblems, setShowProblems] = useState(false)
  const problems = venueInputProblems(details)

  const create = useMutation({
    mutationFn: (placed: MapPoint) => createVenue(details, placed),
    onSuccess: async (venueId) => {
      await queryClient.invalidateQueries({ queryKey: adminKeys.venues })
      await navigate(`/admin/venues/${venueId}`)
    },
  })

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (Object.keys(problems).length > 0 || pin === null) {
          setShowProblems(true)
          return
        }
        create.mutate(pin)
      }}
    >
      <h2 className="text-lg font-semibold">{t('admin.venues.new')}</h2>
      <VenueDetailsFields
        value={details}
        invalidField={invalidField(create.error)}
        problems={showProblems ? problems : undefined}
        onSlugEdited={() => setSlugEdited(true)}
        onChange={(next) =>
          setDetails(
            slugEdited || next.name === details.name
              ? next
              : { ...next, slug: slugFromName(next.name) },
          )
        }
      />
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">{t('admin.pin.title')}</h3>
        {/* The radius circle appears once the pin is placed, not at the start view. */}
        <PinEditor
          pin={pin ?? START_PIN}
          onChange={setPin}
          radiusM={pin ? DEFAULT_RADIUS_M : null}
          locateOnOpen
        />
        {showProblems && pin === null && (
          <p className="text-sm text-rose-700">{t('admin.pin.notPlaced')}</p>
        )}
        {invalidField(create.error) === 'pin' && (
          <p className="text-sm text-rose-700">{t('admin.pin.outsideIndia')}</p>
        )}
      </section>
      <ErrorText error={create.error} />
      <button
        type="submit"
        disabled={create.isPending}
        className="self-start rounded-lg bg-teal-700 px-5 py-2.5 font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500"
      >
        {create.isPending ? t('admin.saving') : t('admin.venues.create')}
      </button>
    </form>
  )
}
