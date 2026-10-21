import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'

// Printable table cards. Each card is drawn on a canvas, then placed in the PDF
// as an image: the browser's canvas shapes Hindi and Gujarati text correctly
// (conjuncts, vowel signs), which jsPDF's own text drawing cannot.

/** The URL inside a table's QR code. Its shape is printed on every card: never change it. */
export function tableUrl(origin: string, slug: string, qrToken: string): string {
  return `${origin}/v/${encodeURIComponent(slug)}/t/${encodeURIComponent(qrToken)}`
}

// A6 portrait (105 × 148 mm) at 300 dpi.
const CARD_MM = { width: 105, height: 148 } as const
const DPI = 300
const PX = (mm: number) => Math.round((mm / 25.4) * DPI)
const CARD_PX = { width: PX(CARD_MM.width), height: PX(CARD_MM.height) }

// Four A6 cards per A4 page, 2 × 2, so any print shop can cut them.
const A4_MM = { width: 210, height: 297 } as const
export const CARDS_PER_PAGE = 4

/** Where card number `index` goes on its page, in millimetres. */
export function cardPosition(index: number): { page: number; x: number; y: number } {
  const slot = index % CARDS_PER_PAGE
  return {
    page: Math.floor(index / CARDS_PER_PAGE),
    x: (slot % 2) * (A4_MM.width / 2),
    y: Math.floor(slot / 2) * (A4_MM.height / 2),
  }
}

export interface CardContent {
  venueName: string
  tableLabel: string
  url: string
  /** "Scan to meet people here" in every UI language, one line each. */
  callToAction: string[]
  footer: string
}

const FONT_FAMILY = '"Noto Sans", "Noto Sans Devanagari", "Noto Sans Gujarati", sans-serif'
const TEAL = '#0f766e'

/**
 * The app's fonts are self-hosted and load per script on demand; a canvas
 * drawn before they load silently falls back to a system font (and may render
 * Gujarati as empty boxes). Wait for exactly the glyphs this card uses.
 */
async function loadFonts(content: CardContent): Promise<void> {
  const texts = [content.venueName, content.tableLabel, content.footer, ...content.callToAction]
  await Promise.all(
    texts.flatMap((text) => [
      document.fonts.load(`600 64px ${FONT_FAMILY}`, text),
      document.fonts.load(`400 64px ${FONT_FAMILY}`, text),
    ]),
  )
}

/** Greedy word wrap with the context's current font. */
function wrapWords(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.trim().split(/\s+/)) {
    const candidate = line === '' ? word : `${line} ${word}`
    if (line !== '' && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line !== '') lines.push(line)
  return lines
}

// Cuts by grapheme (what a reader sees as one letter), never through a Hindi or
// Gujarati conjunct or vowel sign the way cutting by code unit would.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/**
 * Fits text in at most `maxLines` lines of `maxWidth`, shrinking the font from
 * `startSize` to `minSize`. If it still does not fit, the last line is
 * shortened with "…" rather than drawn off the card.
 */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  startSize: number,
  minSize: number,
  weight: number,
): { lines: string[]; size: number } {
  for (let size = startSize; size >= minSize; size -= 4) {
    ctx.font = `${weight} ${size}px ${FONT_FAMILY}`
    const lines = wrapWords(ctx, text, maxWidth)
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      return { lines, size }
    }
  }
  ctx.font = `${weight} ${minSize}px ${FONT_FAMILY}`
  const lines = wrapWords(ctx, text, maxWidth).slice(0, maxLines)
  const last = Array.from(graphemes.segment(lines.at(-1) ?? ''), (s) => s.segment)
  while (last.length > 1 && ctx.measureText(`${last.join('')}…`).width > maxWidth) last.pop()
  lines[lines.length - 1] = `${last.join('')}…`
  return { lines, size: minSize }
}

export async function drawCard(content: CardContent): Promise<HTMLCanvasElement> {
  await loadFonts(content)
  const canvas = document.createElement('canvas')
  canvas.width = CARD_PX.width
  canvas.height = CARD_PX.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  const W = CARD_PX.width
  const margin = 70
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, CARD_PX.height)

  // Header band with the venue name.
  const bandHeight = 330
  ctx.fillStyle = TEAL
  ctx.fillRect(0, 0, W, bandHeight)
  ctx.fillStyle = '#ffffff'
  const name = fitText(ctx, content.venueName, W - margin * 2, 2, 92, 52, 600)
  ctx.font = `600 ${name.size}px ${FONT_FAMILY}`
  const nameTop = bandHeight / 2 - ((name.lines.length - 1) * name.size * 1.15) / 2
  name.lines.forEach((line, i) => ctx.fillText(line.trim(), W / 2, nameTop + i * name.size * 1.15))

  // Table label.
  ctx.fillStyle = '#0f172a'
  const label = fitText(ctx, content.tableLabel, W - margin * 2, 1, 110, 60, 600)
  ctx.font = `600 ${label.size}px ${FONT_FAMILY}`
  ctx.fillText(label.lines[0] ?? content.tableLabel, W / 2, 440)

  // QR code. Error correction M survives normal wear and a little dirt.
  const qrSize = 880
  const qr = await QRCode.toCanvas(content.url, {
    width: qrSize,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  })
  ctx.drawImage(qr, (W - qrSize) / 2, 520, qrSize, qrSize)

  // Call to action in every language, one line each.
  ctx.fillStyle = '#334155'
  content.callToAction.forEach((line, i) => {
    const fitted = fitText(ctx, line, W - margin * 2, 1, 54, 36, 400)
    ctx.font = `400 ${fitted.size}px ${FONT_FAMILY}`
    ctx.fillText(fitted.lines[0] ?? line, W / 2, 1480 + i * 74)
  })

  ctx.fillStyle = TEAL
  ctx.font = `600 40px ${FONT_FAMILY}`
  ctx.fillText(content.footer, W / 2, CARD_PX.height - 70)

  // Thin border as a cutting guide.
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 3
  ctx.strokeRect(1.5, 1.5, W - 3, CARD_PX.height - 3)
  return canvas
}

/** Builds the PDF of all cards and starts the download. */
export async function downloadCardsPdf(cards: CardContent[], fileName: string): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  for (const [index, card] of cards.entries()) {
    const { page, x, y } = cardPosition(index)
    if (page > 0 && index % CARDS_PER_PAGE === 0) doc.addPage()
    const canvas = await drawCard(card)
    // JPEG at high quality keeps a 20-table PDF a few MB; the QR stays crisp at 300 dpi.
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', x, y, CARD_MM.width, CARD_MM.height)
  }
  doc.save(fileName)
}
